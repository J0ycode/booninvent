import "server-only";
import { and, eq, lt, sql } from "drizzle-orm";
import { withTransaction, getDb, type Tx } from "./db";
import { idempotencyKeys, counters } from "./db/schema";
import { writeAudit } from "./audit";
import { AppError, duplicateConstraint } from "./errors";
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
    throw new AppError("TENANT_SUSPENDED", "This shop is suspended, so changes are turned off. Please contact support.");
  }
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Runs a state-changing operation:
 *  - rejects writes for suspended shops,
 *  - runs fn in one Postgres transaction,
 *  - records the idempotency key and an audit_logs row in that same transaction.
 * The result must be plain JSON (it is stored for idempotent replays).
 */
export async function runMutation<T>(ctx: Ctx, opts: MutationOptions, fn: (tx: Tx) => Promise<MutationOutput<T>>): Promise<T> {
  assertWritable(ctx);
  const scope = `${ctx.tenantId ?? "platform"}:${ctx.userId}`;
  const key = opts.idempotencyKey?.trim() || null;
  try {
    return await withTransaction(async (tx) => {
      // A concurrent request with the same key waits here until the first one commits, then fails with a
      // unique violation and is answered from the stored result below.
      if (key) await tx.insert(idempotencyKeys).values({ scope, key, result: null });
      const out = await fn(tx);
      const plain = out.result === undefined ? null : JSON.parse(JSON.stringify(out.result));
      if (key) {
        await tx
          .update(idempotencyKeys)
          .set({ result: plain })
          .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
      }
      await writeAudit(ctx, opts.action, opts.entity, out.entityId, out.audit, tx);
      return plain as T;
    });
  } catch (e) {
    if (key && duplicateConstraint(e) === "idempotency_scope_key_uq") {
      const db = await getDb();
      const [prev] = await db
        .select({ result: idempotencyKeys.result })
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
      if (prev) return prev.result as T;
    }
    throw e;
  } finally {
    // Keys are only needed for a day. Clean up now and then instead of running a background job.
    if (key && Math.random() < 0.02) {
      const db = await getDb();
      await db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.createdAt, new Date(Date.now() - IDEMPOTENCY_TTL_MS)))
        .catch(() => {});
    }
  }
}

/** Per-tenant sequence, e.g. nextSeq(tenantId, "dispatch") -> 1, 2, 3 ... Atomic (row lock on the counter). */
export async function nextSeq(tenantId: string, name: string, tx?: Tx): Promise<number> {
  const db = tx ?? (await getDb());
  const [row] = await db
    .insert(counters)
    .values({ tenantId, name, seq: 1 })
    .onConflictDoUpdate({ target: [counters.tenantId, counters.name], set: { seq: sql`${counters.seq} + 1` } })
    .returning({ seq: counters.seq });
  return row.seq;
}

/** Reserves n consecutive numbers and returns the number before the first one (use result+1 .. result+n). */
export async function reserveSeq(tenantId: string, name: string, n: number, tx: Tx): Promise<number> {
  if (n <= 0) return 0;
  const [row] = await tx
    .insert(counters)
    .values({ tenantId, name, seq: n })
    .onConflictDoUpdate({ target: [counters.tenantId, counters.name], set: { seq: sql`${counters.seq} + ${n}` } })
    .returning({ seq: counters.seq });
  return row.seq - n;
}

export const docNumber = (prefix: string, n: number) => `${prefix}-${String(n).padStart(5, "0")}`;
