import "server-only";
import { z } from "zod";
import { and, count, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, type Tx } from "../db";
import { returnDamageEntries, products, locations } from "../db/schema";
import { stockLevels } from "../db/stock-schema";
import type { ReturnType } from "../db/types";
import { guard, tf, staffLocationId, assertLocationAccess, assertId, isId } from "../data/guard";
import { runMutation } from "../mutation";
import { AppError } from "../errors";
import { applyMoves, mergeLines, type Move } from "./core";
import { objectId, qty } from "@/lib/validation";
import type { Ctx, TenantCtx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;
const ALL = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;

export interface ReturnEntryView {
  id: string;
  locationId: string;
  type: ReturnType;
  productId: string;
  quantity: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote?: string;
  createdAt: string;
  decidedAt: string | null;
}
type EntryRow = typeof returnDamageEntries.$inferSelect;
const view = (e: EntryRow): ReturnEntryView => ({
  id: e.id,
  locationId: e.locationId,
  type: e.type,
  productId: e.productId,
  quantity: e.quantity,
  reason: e.reason,
  status: e.status,
  decisionNote: e.decisionNote ?? undefined,
  createdAt: e.createdAt.toISOString(),
  decidedAt: e.decidedAt?.toISOString() ?? null,
});

export const TYPE_LABEL: Record<ReturnType, string> = {
  RETURN_TO_STOREROOM: "Return to Store Room",
  DAMAGED: "Damaged (write off)",
  SUPPLIER_RETURN: "Return to supplier",
};

async function storeRoomId(c: TenantCtx, tx: Tx): Promise<string> {
  const [sr] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, c.tenantId), eq(locations.type, "STORE_ROOM")));
  if (!sr) throw new AppError("NOT_FOUND", "Store Room not found.");
  return sr.id;
}

/** Stock moves for an approved entry. */
async function movesFor(c: TenantCtx, e: { type: ReturnType; locationId: string; productId: string; quantity: number; reason: string }, tx: Tx): Promise<Move[]> {
  const note = e.reason;
  if (e.type === "RETURN_TO_STOREROOM") {
    return [
      { productId: e.productId, locationId: e.locationId, delta: -e.quantity, type: "RETURN_OUT", note },
      { productId: e.productId, locationId: await storeRoomId(c, tx), delta: e.quantity, type: "RETURN_IN", note },
    ];
  }
  if (e.type === "SUPPLIER_RETURN") return [{ productId: e.productId, locationId: e.locationId, delta: -e.quantity, type: "SUPPLIER_RETURN", note }];
  return [{ productId: e.productId, locationId: e.locationId, delta: -e.quantity, type: "DAMAGE", note }];
}

export const entrySchema = z.object({
  type: z.enum(["RETURN_TO_STOREROOM", "DAMAGED", "SUPPLIER_RETURN"]),
  reason: z.string().trim().min(2, "Give a short reason").max(300),
  lines: z
    .array(z.object({ productId: objectId, quantity: qty }))
    .min(1, "Add at least one product")
    .max(100),
});

/**
 * Store staff: "Return to Store Room" or "Damaged" at their store -> PENDING until a manager approves (no stock change yet).
 * Store Room manager / owner: "Damaged" or "Return to supplier" at the Store Room -> applied immediately (they are the approvers).
 * One entry per product line.
 */
export async function createEntries(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<ReturnEntryView[]> {
  const c = await guard(ctx, ALL);
  const d = entrySchema.parse(input);
  const lines = mergeLines(d.lines);
  const isStaff = c.role === "STORE_STAFF";
  if (isStaff && d.type === "SUPPLIER_RETURN") throw new AppError("FORBIDDEN", "Stores return stock to the Store Room, not to suppliers.");
  if (!isStaff && d.type === "RETURN_TO_STOREROOM") throw new AppError("VALIDATION", "Store Room entries are Damaged or Return to supplier.");

  return runMutation(c, { action: isStaff ? "returns.request" : "returns.record", entity: "returnDamageEntry", idempotencyKey }, async (tx) => {
    const locationId = isStaff ? staffLocationId(c) : await storeRoomId(c, tx);
    const ids = lines.map((l) => l.productId);
    const [{ n }] = await tx
      .select({ n: count() })
      .from(products)
      .where(and(eq(products.tenantId, c.tenantId), inArray(products.id, ids)));
    if (n !== lines.length) throw new AppError("VALIDATION", "One of the products was not found.");

    if (isStaff) {
      // Friendly early check; the real guarantee is the conditional decrement on approval.
      const levels = await tx
        .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
        .from(stockLevels)
        .where(and(eq(stockLevels.tenantId, c.tenantId), eq(stockLevels.locationId, locationId), inArray(stockLevels.productId, ids)));
      const have = new Map(levels.map((l) => [l.productId, l.quantity]));
      for (const l of lines) {
        const q = have.get(l.productId) ?? 0;
        if (q < l.quantity) throw new AppError("INSUFFICIENT_STOCK", `You only have ${q} of one of these products.`);
      }
    }
    const now = new Date();
    const rows = await tx
      .insert(returnDamageEntries)
      .values(
        lines.map((l) => ({
          ...tf(c),
          locationId,
          type: d.type,
          productId: l.productId,
          quantity: l.quantity,
          reason: d.reason,
          status: isStaff ? ("PENDING" as const) : ("APPROVED" as const),
          createdBy: c.userId,
          ...(isStaff ? {} : { decidedBy: c.userId, decidedAt: now, decisionNote: "Recorded by Store Room" }),
        })),
      )
      .returning();
    // RETURNING keeps the insert order in practice; sort by the input order anyway so results match the form.
    const order = new Map(ids.map((id, i) => [id, i]));
    rows.sort((a, b) => order.get(a.productId)! - order.get(b.productId)!);
    if (!isStaff) {
      for (const e of rows) {
        await applyMoves(c, tx, await movesFor(c, { type: d.type, locationId, productId: e.productId, quantity: e.quantity, reason: d.reason }, tx), {
          refType: "returnDamage",
          refId: e.id,
        });
      }
    }
    return { result: rows.map(view), entityId: rows[0].id, audit: { type: d.type, lines: lines.length, applied: !isStaff } };
  });
}

/** Loads one entry of this shop and locks it, so it cannot be decided twice. */
async function loadPending(c: TenantCtx, id: string, tx: Tx): Promise<EntryRow> {
  assertId(id, "Entry not found.");
  const [e] = await tx
    .select()
    .from(returnDamageEntries)
    .where(and(eq(returnDamageEntries.tenantId, c.tenantId), eq(returnDamageEntries.id, id)))
    .for("update");
  if (!e) throw new AppError("NOT_FOUND", "Entry not found.");
  if (e.status !== "PENDING") throw new AppError("INVALID_STATE", "This entry was already decided.");
  return e;
}

/** Approve a pending store entry: stock changes now (RETURN_OUT + RETURN_IN, or DAMAGE). */
export async function approveEntry(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<ReturnEntryView> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "returns.approve", entity: "returnDamageEntry", idempotencyKey }, async (tx) => {
    const e = await loadPending(c, id, tx);
    await applyMoves(c, tx, await movesFor(c, e, tx), { refType: "returnDamage", refId: id });
    const [row] = await tx
      .update(returnDamageEntries)
      .set({ status: "APPROVED", decidedBy: c.userId, decidedAt: new Date() })
      .where(eq(returnDamageEntries.id, id))
      .returning();
    return { result: view(row), entityId: id, audit: { type: e.type, quantity: e.quantity } };
  });
}

export async function rejectEntry(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<ReturnEntryView> {
  const c = await guard(ctx, MANAGERS);
  const { note } = z.object({ note: z.string().trim().min(2, "Give a short reason").max(300) }).parse(input);
  return runMutation(c, { action: "returns.reject", entity: "returnDamageEntry", idempotencyKey }, async (tx) => {
    await loadPending(c, id, tx);
    const [row] = await tx
      .update(returnDamageEntries)
      .set({ status: "REJECTED", decidedBy: c.userId, decidedAt: new Date(), decisionNote: note })
      .where(eq(returnDamageEntries.id, id))
      .returning();
    return { result: view(row), entityId: id, audit: { note } };
  });
}

export async function listEntries(
  ctx: Ctx | null,
  opts: { status?: "PENDING" | "APPROVED" | "REJECTED"; locationId?: string; type?: ReturnType; from?: Date; to?: Date; page?: number; pageSize?: number } = {},
) {
  const c = await guard(ctx, ALL);
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(opts.page ?? 1, 1);
  const empty = { rows: [] as ReturnEntryView[], total: 0, page, pageSize };
  if (opts.locationId) {
    assertLocationAccess(c, opts.locationId);
    if (!isId(opts.locationId)) return empty;
  } else if (c.role === "STORE_STAFF" && !c.locationIds.length) return empty;
  const where = and(
    eq(returnDamageEntries.tenantId, c.tenantId),
    opts.locationId
      ? eq(returnDamageEntries.locationId, opts.locationId)
      : c.role === "STORE_STAFF"
        ? inArray(returnDamageEntries.locationId, c.locationIds)
        : undefined,
    opts.status ? eq(returnDamageEntries.status, opts.status) : undefined,
    opts.type ? eq(returnDamageEntries.type, opts.type) : undefined,
    opts.from ? gte(returnDamageEntries.createdAt, opts.from) : undefined,
    opts.to ? lte(returnDamageEntries.createdAt, opts.to) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select()
    .from(returnDamageEntries)
    .where(where)
    .orderBy(desc(returnDamageEntries.createdAt), desc(returnDamageEntries.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(returnDamageEntries).where(where);
  return { rows: rows.map(view), total, page, pageSize };
}
