import "server-only";
import type { ClientSession } from "mongoose";
import { withTransaction, connectDb } from "./db";
import { IdempotencyKey, Counter } from "./models/core";
import { writeAudit } from "./audit";
import { AppError, isDuplicateKey } from "./errors";
import type { Ctx } from "./context";

export interface MutationOptions {
  /** Audit action name, e.g. "product.create". */
  action: string;
  entity: string;
  /** Client-supplied idempotency key; a repeat with the same key returns the first result. */
  idempotencyKey?: string | null;
}

export interface MutationOutput<T> {
  result: T;
  entityId?: string;
  audit?: unknown;
}

/** Suspended shops can sign in and read, but every write is rejected. */
export function assertWritable(ctx: Ctx) {
  if (ctx.tenantStatus === "SUSPENDED") {
    throw new AppError(
      "TENANT_SUSPENDED",
      "This shop is suspended, so changes are turned off. Please contact support.",
    );
  }
}

/**
 * Runs a state-changing operation:
 *  - rejects writes for suspended shops,
 *  - runs fn in one MongoDB transaction,
 *  - records the idempotency key and an auditLog entry in that same transaction.
 * The result must be plain JSON (it is stored for idempotent replays).
 */
export async function runMutation<T>(
  ctx: Ctx,
  opts: MutationOptions,
  fn: (session: ClientSession) => Promise<MutationOutput<T>>,
): Promise<T> {
  assertWritable(ctx);
  const scope = `${ctx.tenantId ?? "platform"}:${ctx.userId}`;
  const key = opts.idempotencyKey?.trim() || null;
  try {
    return await withTransaction(async (session) => {
      if (key) await IdempotencyKey.create([{ scope, key, result: null }], { session });
      const out = await fn(session);
      const plain = out.result === undefined ? null : JSON.parse(JSON.stringify(out.result));
      if (key) await IdempotencyKey.updateOne({ scope, key }, { $set: { result: plain } }, { session });
      await writeAudit(ctx, opts.action, opts.entity, out.entityId, out.audit, session);
      return plain as T;
    });
  } catch (e) {
    if (key && isDuplicateKey(e) && (e as { keyPattern?: Record<string, unknown> }).keyPattern?.scope) {
      await connectDb();
      const prev = await IdempotencyKey.findOne({ scope, key }).lean();
      if (prev) return prev.result as T;
    }
    throw e;
  }
}

/** Per-tenant sequence, e.g. nextSeq(tenantId, "dispatch") -> 1, 2, 3 ... */
export async function nextSeq(tenantId: string, name: string, session?: ClientSession): Promise<number> {
  const c = await Counter.findOneAndUpdate(
    { tenantId, name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  ).lean();
  return c!.seq;
}

export const docNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(5, "0")}`;
