import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import { getDb, type Tx } from "../db";
import { dispatches, restockRequests, locations } from "../db/schema";
import type { DispatchLine, DispatchStatus } from "../db/types";
import { guard, tf, assertLocationAccess, assertId, isId } from "../data/guard";
import { runMutation, nextSeq, docNumber } from "../mutation";
import { AppError } from "../errors";
import { applyMoves, mergeLines, type Move } from "./core";
import { objectId, qty } from "@/lib/validation";
import type { Ctx, TenantCtx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;
const ALL = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;

export interface DispatchLineView {
  id: string;
  productId: string;
  quantity: number;
  receivedQty: number | null;
  missingQty: number;
  damagedQty: number;
  note?: string;
  resolution: { action: "RETURN" | "WRITE_OFF"; at: string; note?: string } | null;
}
export interface DispatchView {
  id: string;
  number: string;
  fromLocationId: string;
  toLocationId: string;
  status: DispatchStatus;
  note?: string;
  restockRequestId: string | null;
  lines: DispatchLineView[];
  totalPieces: number;
  issuePieces: number;
  openIssues: number;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
}

type DispatchRow = typeof dispatches.$inferSelect;

function view(d: DispatchRow): DispatchView {
  const lines = d.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    quantity: l.quantity,
    receivedQty: l.receivedQty ?? null,
    missingQty: l.missingQty ?? 0,
    damagedQty: l.damagedQty ?? 0,
    note: l.note,
    resolution: l.resolution ? { action: l.resolution.action, at: l.resolution.at, note: l.resolution.note } : null,
  }));
  return {
    id: d.id,
    number: d.number,
    fromLocationId: d.fromLocationId,
    toLocationId: d.toLocationId,
    status: d.status,
    note: d.note ?? undefined,
    restockRequestId: d.restockRequestId,
    lines,
    totalPieces: lines.reduce((s, l) => s + l.quantity, 0),
    issuePieces: lines.reduce((s, l) => s + l.missingQty + l.damagedQty, 0),
    openIssues: lines.filter((l) => l.missingQty + l.damagedQty > 0 && !l.resolution).length,
    createdAt: d.createdAt.toISOString(),
    dispatchedAt: d.dispatchedAt?.toISOString() ?? null,
    receivedAt: d.receivedAt?.toISOString() ?? null,
  };
}

const newLines = (lines: { productId: string; quantity: number }[]): DispatchLine[] =>
  mergeLines(lines).map((l) => ({ id: randomUUID(), productId: l.productId, quantity: l.quantity, receivedQty: null, missingQty: 0, damagedQty: 0 }));

/** STORE_STAFF only see dispatches sent to their store, and never drafts. null = sees nothing. */
function visibility(c: TenantCtx): SQL | null {
  if (c.role !== "STORE_STAFF") return eq(dispatches.tenantId, c.tenantId);
  if (!c.locationIds.length) return null;
  return and(eq(dispatches.tenantId, c.tenantId), inArray(dispatches.toLocationId, c.locationIds), ne(dispatches.status, "DRAFT"))!;
}

/** Loads the dispatch and locks its row until the transaction ends, so two people cannot send or receive it twice. */
async function loadForUpdate(c: TenantCtx, id: string, tx: Tx): Promise<DispatchRow> {
  const vis = visibility(c);
  if (!isId(id) || !vis) throw new AppError("NOT_FOUND", "Dispatch not found.");
  const [d] = await tx
    .select()
    .from(dispatches)
    .where(and(vis, eq(dispatches.id, id)))
    .for("update");
  if (!d) throw new AppError("NOT_FOUND", "Dispatch not found.");
  return d;
}

async function save(tx: Tx, id: string, set: Partial<typeof dispatches.$inferInsert>): Promise<DispatchRow> {
  const [d] = await tx.update(dispatches).set(set).where(eq(dispatches.id, id)).returning();
  return d;
}

/* ---------- drafts ---------- */

export const draftSchema = z.object({
  toLocationId: objectId,
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ productId: objectId, quantity: qty }))
    .min(1, "Add at least one product")
    .max(500),
});

async function findStore(c: TenantCtx, tx: Tx, id: string) {
  const [dest] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, c.tenantId), eq(locations.id, id), eq(locations.type, "STORE")));
  if (!dest) throw new AppError("VALIDATION", "Pick one of your stores.");
  return dest;
}

/** Inserts a draft inside an existing transaction (also used when approving a restock request). */
export async function insertDraft(c: TenantCtx, tx: Tx, d: z.output<typeof draftSchema>, restockRequestId: string | null = null): Promise<DispatchRow> {
  const [storeRoom] = await tx
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, c.tenantId), eq(locations.type, "STORE_ROOM")));
  if (!storeRoom) throw new AppError("NOT_FOUND", "Store Room not found.");
  const dest = await findStore(c, tx, d.toLocationId);
  const number = docNumber("DSP", await nextSeq(c.tenantId, "dispatch", tx));
  const [row] = await tx
    .insert(dispatches)
    .values({
      ...tf(c),
      number,
      fromLocationId: storeRoom.id,
      toLocationId: dest.id,
      status: "DRAFT",
      lines: newLines(d.lines),
      note: d.note,
      restockRequestId,
      createdBy: c.userId,
    })
    .returning();
  return row;
}

/** Create (id = null) or replace a DRAFT dispatch. No stock changes until it is sent. */
export async function saveDraft(ctx: Ctx | null, id: string | null, input: unknown, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, MANAGERS);
  const d = draftSchema.parse(input);
  return runMutation(c, { action: id ? "dispatch.update_draft" : "dispatch.create_draft", entity: "dispatch", idempotencyKey }, async (tx) => {
    if (!id) {
      const row = await insertDraft(c, tx, d);
      return { result: view(row), entityId: row.id, audit: { number: row.number } };
    }
    const cur = await loadForUpdate(c, id, tx);
    if (cur.status !== "DRAFT") throw new AppError("INVALID_STATE", "This dispatch was already sent and can no longer be edited.");
    await findStore(c, tx, d.toLocationId);
    const row = await save(tx, id, { toLocationId: d.toLocationId, note: d.note ?? null, lines: newLines(d.lines) });
    return { result: view(row), entityId: id, audit: { lines: d.lines.length } };
  });
}

export async function discardDraft(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "dispatch.discard_draft", entity: "dispatch", idempotencyKey }, async (tx) => {
    const cur = await loadForUpdate(c, id, tx);
    if (cur.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only drafts can be discarded.");
    await tx.delete(dispatches).where(eq(dispatches.id, cur.id));
    if (cur.restockRequestId) {
      await tx
        .update(restockRequests)
        .set({ dispatchId: null })
        .where(and(eq(restockRequests.tenantId, c.tenantId), eq(restockRequests.id, cur.restockRequestId), eq(restockRequests.status, "APPROVED")));
    }
    return { result: null, entityId: id, audit: { number: cur.number } };
  });
}

/* ---------- send ---------- */

/** DRAFT -> DISPATCHED: deducts Store Room stock (DISPATCH_OUT). The lines are now in transit to the store. */
export async function sendDispatch(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "dispatch.send", entity: "dispatch", idempotencyKey }, async (tx) => {
    const cur = await loadForUpdate(c, id, tx);
    if (cur.status !== "DRAFT") throw new AppError("INVALID_STATE", "This dispatch was already sent.");
    await applyMoves(
      c,
      tx,
      cur.lines.map((l) => ({ productId: l.productId, locationId: cur.fromLocationId, delta: -l.quantity, type: "DISPATCH_OUT" as const })),
      { refType: "dispatch", refId: id },
    );
    const row = await save(tx, id, { status: "DISPATCHED", dispatchedAt: new Date(), dispatchedBy: c.userId });
    if (cur.restockRequestId) {
      await tx
        .update(restockRequests)
        .set({ status: "DISPATCHED", dispatchId: cur.id })
        .where(and(eq(restockRequests.tenantId, c.tenantId), eq(restockRequests.id, cur.restockRequestId)));
    }
    return { result: view(row), entityId: id, audit: { number: cur.number, pieces: cur.lines.reduce((s, l) => s + l.quantity, 0) } };
  });
}

/* ---------- store receipt ---------- */

export const receiveDispatchSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: objectId,
        receivedQty: z.coerce.number().int().min(0),
        missingQty: z.coerce.number().int().min(0),
        damagedQty: z.coerce.number().int().min(0),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1),
});

/**
 * Store staff confirm what arrived. received + missing + damaged must equal the sent quantity per line.
 * Good pieces are added to the store (DISPATCH_IN). Any missing/damaged makes it "Received with issues".
 */
export async function receiveDispatch(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, ["OWNER", "STORE_STAFF"]);
  const d = receiveDispatchSchema.parse(input);
  return runMutation(c, { action: "dispatch.receive", entity: "dispatch", idempotencyKey }, async (tx) => {
    const cur = await loadForUpdate(c, id, tx);
    assertLocationAccess(c, cur.toLocationId);
    if (cur.status !== "DISPATCHED") throw new AppError("INVALID_STATE", "This dispatch is not waiting to be received.");
    const byId = new Map(d.lines.map((l) => [l.lineId, l]));
    if (byId.size !== cur.lines.length || cur.lines.some((l) => !byId.has(l.id))) {
      throw new AppError("VALIDATION", "Enter the received quantity for every line.");
    }
    let issues = false;
    const moves: Move[] = [];
    const lines = cur.lines.map((line): DispatchLine => {
      const r = byId.get(line.id)!;
      if (r.receivedQty + r.missingQty + r.damagedQty !== line.quantity) {
        throw new AppError("VALIDATION", `Received + missing + damaged must add up to ${line.quantity} for every line.`);
      }
      if (r.missingQty + r.damagedQty > 0) {
        issues = true;
        if (!r.note) throw new AppError("VALIDATION", "Add a note for each line with missing or damaged pieces.");
      }
      if (r.receivedQty > 0) moves.push({ productId: line.productId, locationId: cur.toLocationId, delta: r.receivedQty, type: "DISPATCH_IN" });
      return { ...line, receivedQty: r.receivedQty, missingQty: r.missingQty, damagedQty: r.damagedQty, note: r.note };
    });
    await applyMoves(c, tx, moves, { refType: "dispatch", refId: id });
    const row = await save(tx, id, { lines, status: issues ? "RECEIVED_WITH_ISSUES" : "RECEIVED", receivedAt: new Date(), receivedBy: c.userId });
    return { result: view(row), entityId: id, audit: { number: cur.number, issues } };
  });
}

/* ---------- discrepancy resolution ---------- */

export const resolveSchema = z.object({
  lineId: objectId,
  action: z.enum(["RETURN", "WRITE_OFF"]),
  note: z.string().trim().max(300).optional(),
});

/**
 * Store Room resolves a missing/damaged line:
 *  RETURN    -> the pieces go back into Store Room stock (RETURN_IN).
 *  WRITE_OFF -> the pieces are written off: RETURN_IN then DAMAGE at the Store Room, so the ledger shows both steps and the net change is zero.
 */
export async function resolveDiscrepancy(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, MANAGERS);
  const d = resolveSchema.parse(input);
  return runMutation(c, { action: "dispatch.resolve_discrepancy", entity: "dispatch", idempotencyKey }, async (tx) => {
    const cur = await loadForUpdate(c, id, tx);
    if (cur.status !== "RECEIVED_WITH_ISSUES") throw new AppError("INVALID_STATE", "This dispatch has no open issues.");
    const line = cur.lines.find((l) => l.id === d.lineId);
    if (!line) throw new AppError("NOT_FOUND", "Line not found.");
    const n = (line.missingQty ?? 0) + (line.damagedQty ?? 0);
    if (n === 0) throw new AppError("INVALID_STATE", "This line has no missing or damaged pieces.");
    if (line.resolution) throw new AppError("INVALID_STATE", "This line was already resolved.");
    const loc = cur.fromLocationId;
    const pid = line.productId;
    const note = d.note ?? `${cur.number} discrepancy`;
    const moves: Move[] = [{ productId: pid, locationId: loc, delta: n, type: "RETURN_IN", note }];
    if (d.action === "WRITE_OFF") moves.push({ productId: pid, locationId: loc, delta: -n, type: "DAMAGE", note: `Written off: ${note}` });
    await applyMoves(c, tx, moves, { refType: "dispatch", refId: id });
    const lines = cur.lines.map((l): DispatchLine =>
      l.id === d.lineId ? { ...l, resolution: { action: d.action, by: c.userId, at: new Date().toISOString(), note: d.note } } : l,
    );
    const open = lines.some((l) => (l.missingQty ?? 0) + (l.damagedQty ?? 0) > 0 && !l.resolution);
    const row = await save(tx, id, { lines, status: open ? cur.status : "RESOLVED" });
    return { result: view(row), entityId: id, audit: { number: cur.number, lineId: d.lineId, action: d.action, pieces: n } };
  });
}

/* ---------- reads ---------- */

export async function listDispatches(
  ctx: Ctx | null,
  opts: { status?: DispatchStatus | DispatchStatus[]; toLocationId?: string; from?: Date; to?: Date; page?: number; pageSize?: number } = {},
) {
  const c = await guard(ctx, ALL);
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(opts.page ?? 1, 1);
  const empty = { rows: [] as DispatchView[], total: 0, page, pageSize };
  const vis = visibility(c);
  if (!vis) return empty;
  let statuses: DispatchStatus[] | null = null;
  if (opts.status) {
    const st = Array.isArray(opts.status) ? opts.status : [opts.status];
    statuses = c.role === "STORE_STAFF" ? st.filter((s) => s !== "DRAFT") : st;
    if (!statuses.length) return empty;
  }
  if (opts.toLocationId) {
    assertLocationAccess(c, opts.toLocationId);
    if (!isId(opts.toLocationId)) return empty;
  }
  const where = and(
    vis,
    statuses ? inArray(dispatches.status, statuses) : undefined,
    opts.toLocationId ? eq(dispatches.toLocationId, opts.toLocationId) : undefined,
    opts.from ? gte(dispatches.createdAt, opts.from) : undefined,
    opts.to ? lte(dispatches.createdAt, opts.to) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select()
    .from(dispatches)
    .where(where)
    .orderBy(desc(dispatches.createdAt), desc(dispatches.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(dispatches).where(where);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getDispatch(ctx: Ctx | null, id: string): Promise<DispatchView> {
  const c = await guard(ctx, ALL);
  assertId(id, "Dispatch not found.");
  const vis = visibility(c);
  if (!vis) throw new AppError("NOT_FOUND", "Dispatch not found.");
  const db = await getDb();
  const [d] = await db
    .select()
    .from(dispatches)
    .where(and(vis, eq(dispatches.id, id)));
  if (!d) throw new AppError("NOT_FOUND", "Dispatch not found.");
  return view(d);
}
