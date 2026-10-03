import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, type SQL } from "drizzle-orm";
import { getDb, type Tx } from "../db";
import { restockRequests, products } from "../db/schema";
import type { RestockLine, RestockStatus } from "../db/types";
import { guard, tf, staffLocationId, assertLocationAccess, assertId, isId } from "./guard";
import { runMutation, nextSeq, docNumber } from "../mutation";
import { AppError } from "../errors";
import { lowStockAt } from "../stock/read";
import { insertDraft } from "../stock/dispatches";
import { mergeLines } from "../stock/core";
import { objectId, qty } from "@/lib/validation";
import type { Ctx, TenantCtx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;
const ALL = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;
/** The Store Room only ever sees requests after the store forwarded them. */
const VISIBLE_TO_STOREROOM: RestockStatus[] = ["SENT", "APPROVED", "REJECTED", "DISPATCHED"];

export interface RestockLineView {
  id: string;
  productId: string;
  quantity: number;
  suggestedQty: number | null;
  lineStatus: "PENDING" | "APPROVED" | "SKIPPED";
}
export interface RestockView {
  id: string;
  number: string;
  locationId: string;
  source: "MANUAL" | "SUGGESTED";
  status: RestockStatus;
  note?: string;
  rejectReason?: string;
  dispatchId: string | null;
  lines: RestockLineView[];
  approvedPieces: number;
  pendingLines: number;
  createdAt: string;
  sentAt: string | null;
}

type RestockRow = typeof restockRequests.$inferSelect;

function view(r: RestockRow): RestockView {
  const lines = r.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    quantity: l.quantity,
    suggestedQty: l.suggestedQty ?? null,
    lineStatus: l.lineStatus,
  }));
  return {
    id: r.id,
    number: r.number,
    locationId: r.locationId,
    source: r.source,
    status: r.status,
    note: r.note ?? undefined,
    rejectReason: r.rejectReason ?? undefined,
    dispatchId: r.dispatchId,
    lines,
    approvedPieces: lines.filter((l) => l.lineStatus === "APPROVED").reduce((s, l) => s + l.quantity, 0),
    pendingLines: lines.filter((l) => l.lineStatus === "PENDING").length,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

/** Store staff see their own store's requests; the Store Room sees forwarded ones. null = sees nothing. */
function visibility(c: TenantCtx): SQL | null {
  if (c.role === "STORE_STAFF") {
    if (!c.locationIds.length) return null;
    return and(eq(restockRequests.tenantId, c.tenantId), inArray(restockRequests.locationId, c.locationIds))!;
  }
  return and(eq(restockRequests.tenantId, c.tenantId), inArray(restockRequests.status, VISIBLE_TO_STOREROOM))!;
}

/** Loads the request and locks its row until the transaction ends, so it cannot be decided twice. */
async function load(c: TenantCtx, id: string, tx: Tx): Promise<RestockRow> {
  const vis = visibility(c);
  if (!isId(id) || !vis) throw new AppError("NOT_FOUND", "Request not found.");
  const [r] = await tx
    .select()
    .from(restockRequests)
    .where(and(vis, eq(restockRequests.id, id)))
    .for("update");
  if (!r) throw new AppError("NOT_FOUND", "Request not found.");
  return r;
}

async function save(tx: Tx, id: string, set: Partial<typeof restockRequests.$inferInsert>): Promise<RestockRow> {
  const [r] = await tx.update(restockRequests).set(set).where(eq(restockRequests.id, id)).returning();
  return r;
}

async function assertActiveProducts(c: TenantCtx, ids: string[], tx: Tx) {
  const [{ n }] = await tx
    .select({ n: count() })
    .from(products)
    .where(and(eq(products.tenantId, c.tenantId), inArray(products.id, ids), eq(products.active, true)));
  if (n !== new Set(ids).size) throw new AppError("VALIDATION", "One of the products is not available.");
}

/* ---------- store staff ---------- */

export const manualSchema = z.object({
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(z.object({ productId: objectId, quantity: qty }))
    .min(1, "Add at least one product")
    .max(300),
});

/** Manual request: store staff pick products and quantities and send it straight to the Store Room. */
export async function createManualRequest(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, ["STORE_STAFF"]);
  const d = manualSchema.parse(input);
  const locationId = staffLocationId(c);
  return runMutation(c, { action: "restock.create_manual", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const lines = mergeLines(d.lines);
    await assertActiveProducts(
      c,
      lines.map((l) => l.productId),
      tx,
    );
    const number = docNumber("REQ", await nextSeq(c.tenantId, "restock", tx));
    const [r] = await tx
      .insert(restockRequests)
      .values({
        ...tf(c),
        number,
        locationId,
        source: "MANUAL",
        status: "SENT",
        sentAt: new Date(),
        note: d.note,
        lines: lines.map((l): RestockLine => ({ id: randomUUID(), productId: l.productId, quantity: l.quantity, suggestedQty: null, lineStatus: "APPROVED" })),
        createdBy: c.userId,
      })
      .returning();
    return { result: view(r), entityId: r.id, audit: { number, lines: lines.length } };
  });
}

/**
 * "Suggest restock": products at or below their reorder level at this store, quantity = max(1, reorderLevel * 2 - current).
 * Private to the store ("Waiting for Staff Approval") until forwarded. Replaces any earlier suggestion that was not forwarded.
 */
export async function suggestRestock(ctx: Ctx | null, idempotencyKey?: string): Promise<RestockView | null> {
  const c = await guard(ctx, ["STORE_STAFF"]);
  const locationId = staffLocationId(c);
  const low = await lowStockAt(c, locationId);
  if (!low.length) return null;
  return runMutation(c, { action: "restock.suggest", entity: "restockRequest", idempotencyKey }, async (tx) => {
    await tx
      .delete(restockRequests)
      .where(and(eq(restockRequests.tenantId, c.tenantId), eq(restockRequests.locationId, locationId), eq(restockRequests.status, "WAITING_STAFF_APPROVAL")));
    const number = docNumber("REQ", await nextSeq(c.tenantId, "restock", tx));
    const lines = low.map((l): RestockLine => {
      const suggested = Math.max(1, l.reorderLevel * 2 - l.quantity);
      return { id: randomUUID(), productId: l.productId, quantity: suggested, suggestedQty: suggested, lineStatus: "PENDING" };
    });
    const [r] = await tx
      .insert(restockRequests)
      .values({ ...tf(c), number, locationId, source: "SUGGESTED", status: "WAITING_STAFF_APPROVAL", lines, createdBy: c.userId })
      .returning();
    return { result: view(r), entityId: r.id, audit: { number, lines: lines.length } };
  });
}

export const lineDecisionSchema = z.object({
  lineId: objectId,
  action: z.enum(["APPROVE", "SKIP"]),
  quantity: qty.optional(), // "Edit" = approve with a different quantity
});

/** Staff Approve / Edit / Skip one suggested line. */
export async function decideSuggestedLine(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, ["STORE_STAFF"]);
  const d = lineDecisionSchema.parse(input);
  return runMutation(c, { action: "restock.decide_line", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const cur = await load(c, id, tx);
    if (cur.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "This request was already forwarded.");
    if (!cur.lines.some((l) => l.id === d.lineId)) throw new AppError("NOT_FOUND", "Line not found.");
    const lines = cur.lines.map((l): RestockLine =>
      l.id === d.lineId
        ? { ...l, lineStatus: d.action === "APPROVE" ? "APPROVED" : "SKIPPED", quantity: d.action === "APPROVE" && d.quantity ? d.quantity : l.quantity }
        : l,
    );
    const r = await save(tx, id, { lines });
    return { result: view(r), entityId: id, audit: d };
  });
}

/** Sends a reviewed suggestion to the Store Room. Every line must be approved or skipped first. */
export async function forwardRequest(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, ["STORE_STAFF"]);
  return runMutation(c, { action: "restock.forward", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const cur = await load(c, id, tx);
    if (cur.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "This request was already forwarded.");
    if (cur.lines.some((l) => l.lineStatus === "PENDING")) throw new AppError("VALIDATION", "Approve, edit or skip every line before forwarding.");
    if (!cur.lines.some((l) => l.lineStatus === "APPROVED")) throw new AppError("VALIDATION", "Approve at least one line, or discard the suggestion.");
    const r = await save(tx, id, { status: "SENT", sentAt: new Date() });
    return { result: view(r), entityId: id, audit: { number: r.number } };
  });
}

export async function discardSuggestion(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, ["STORE_STAFF"]);
  return runMutation(c, { action: "restock.discard", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const cur = await load(c, id, tx);
    if (cur.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "Only an unforwarded suggestion can be discarded.");
    await tx.delete(restockRequests).where(eq(restockRequests.id, cur.id));
    return { result: null, entityId: id, audit: { number: cur.number } };
  });
}

/* ---------- Store Room ---------- */

/** Approve: creates a pre-filled DRAFT dispatch with the approved lines, in one step. */
export async function approveRequest(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<{ request: RestockView; dispatchId: string }> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "restock.approve", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const cur = await load(c, id, tx);
    if (cur.status !== "SENT") throw new AppError("INVALID_STATE", "Only sent requests can be approved.");
    const lines = cur.lines.filter((l) => l.lineStatus === "APPROVED" && l.quantity > 0).map((l) => ({ productId: l.productId, quantity: l.quantity }));
    const draft = await insertDraft(c, tx, { toLocationId: cur.locationId, lines, note: `From request ${cur.number}` }, cur.id);
    const r = await save(tx, id, { status: "APPROVED", decidedBy: c.userId, decidedAt: new Date(), dispatchId: draft.id });
    return { result: { request: view(r), dispatchId: draft.id }, entityId: id, audit: { number: r.number, dispatch: draft.number } };
  });
}

export async function rejectRequest(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, MANAGERS);
  const { reason } = z.object({ reason: z.string().trim().min(2, "Give a short reason").max(300) }).parse(input);
  return runMutation(c, { action: "restock.reject", entity: "restockRequest", idempotencyKey }, async (tx) => {
    const cur = await load(c, id, tx);
    if (cur.status !== "SENT") throw new AppError("INVALID_STATE", "Only sent requests can be rejected.");
    const r = await save(tx, id, { status: "REJECTED", rejectReason: reason, decidedBy: c.userId, decidedAt: new Date() });
    return { result: view(r), entityId: id, audit: { number: r.number, reason } };
  });
}

/* ---------- reads ---------- */

export async function listRequests(ctx: Ctx | null, opts: { status?: RestockStatus; locationId?: string; page?: number; pageSize?: number } = {}) {
  const c = await guard(ctx, ALL);
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const empty = { rows: [] as RestockView[], total: 0, page, pageSize };
  const vis = visibility(c);
  if (!vis) return empty;
  if (opts.status && c.role !== "STORE_STAFF" && !VISIBLE_TO_STOREROOM.includes(opts.status)) return empty;
  if (opts.locationId) {
    assertLocationAccess(c, opts.locationId);
    if (!isId(opts.locationId)) return empty;
  }
  const where = and(
    vis,
    opts.status ? eq(restockRequests.status, opts.status) : undefined,
    opts.locationId ? eq(restockRequests.locationId, opts.locationId) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select()
    .from(restockRequests)
    .where(where)
    .orderBy(desc(restockRequests.updatedAt), desc(restockRequests.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(restockRequests).where(where);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getRequest(ctx: Ctx | null, id: string): Promise<RestockView> {
  const c = await guard(ctx, ALL);
  assertId(id, "Request not found.");
  const vis = visibility(c);
  if (!vis) throw new AppError("NOT_FOUND", "Request not found.");
  const db = await getDb();
  const [r] = await db
    .select()
    .from(restockRequests)
    .where(and(vis, eq(restockRequests.id, id)));
  if (!r) throw new AppError("NOT_FOUND", "Request not found.");
  return view(r);
}
