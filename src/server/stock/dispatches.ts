import "server-only";
import { z } from "zod";
import type { ClientSession } from "mongoose";
import { Dispatch, RestockRequest, type DispatchDoc, type DispatchStatus } from "../models/business";
import { Location } from "../models/core";
import { guard, tf, assertLocationAccess } from "../data/guard";
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

function view(d: DispatchDoc): DispatchView {
  const lines = d.lines.map((l) => ({
    id: String(l._id),
    productId: String(l.productId),
    quantity: l.quantity,
    receivedQty: l.receivedQty ?? null,
    missingQty: l.missingQty ?? 0,
    damagedQty: l.damagedQty ?? 0,
    note: l.note,
    resolution: l.resolution ? { action: l.resolution.action, at: l.resolution.at.toISOString(), note: l.resolution.note } : null,
  }));
  return {
    id: String(d._id),
    number: d.number,
    fromLocationId: String(d.fromLocationId),
    toLocationId: String(d.toLocationId),
    status: d.status,
    note: d.note,
    restockRequestId: d.restockRequestId ? String(d.restockRequestId) : null,
    lines,
    totalPieces: lines.reduce((s, l) => s + l.quantity, 0),
    issuePieces: lines.reduce((s, l) => s + l.missingQty + l.damagedQty, 0),
    openIssues: lines.filter((l) => l.missingQty + l.damagedQty > 0 && !l.resolution).length,
    createdAt: d.createdAt.toISOString(),
    dispatchedAt: d.dispatchedAt?.toISOString() ?? null,
    receivedAt: d.receivedAt?.toISOString() ?? null,
  };
}

/** STORE_STAFF only see dispatches sent to their store, and never drafts. */
function visibilityFilter(c: TenantCtx): Record<string, unknown> {
  return c.role === "STORE_STAFF" ? { ...tf(c), toLocationId: { $in: c.locationIds }, status: { $ne: "DRAFT" } } : tf(c);
}

async function loadForUpdate(c: TenantCtx, id: string, session: ClientSession) {
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Dispatch not found.");
  const d = await Dispatch.findOne({ ...visibilityFilter(c), _id: id }).session(session);
  if (!d) throw new AppError("NOT_FOUND", "Dispatch not found.");
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

/** Inserts a draft inside an existing transaction (also used when approving a restock request). */
export async function insertDraft(c: TenantCtx, session: ClientSession, d: z.output<typeof draftSchema>, restockRequestId: string | null = null) {
  const storeRoom = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).session(session).lean();
  const dest = await Location.findOne({ ...tf(c), _id: d.toLocationId, type: "STORE" }).session(session).lean();
  if (!storeRoom) throw new AppError("NOT_FOUND", "Store Room not found.");
  if (!dest) throw new AppError("VALIDATION", "Pick one of your stores.");
  const number = docNumber("DSP", await nextSeq(c.tenantId, "dispatch", session));
  const [doc] = await Dispatch.create(
    [
      {
        ...tf(c),
        number,
        fromLocationId: storeRoom._id,
        toLocationId: dest._id,
        status: "DRAFT",
        lines: mergeLines(d.lines),
        note: d.note,
        restockRequestId,
        createdBy: c.userId,
      },
    ],
    { session },
  );
  return doc;
}

/** Create (id = null) or replace a DRAFT dispatch. No stock changes until it is sent. */
export async function saveDraft(ctx: Ctx | null, id: string | null, input: unknown, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, MANAGERS);
  const d = draftSchema.parse(input);
  return runMutation(c, { action: id ? "dispatch.update_draft" : "dispatch.create_draft", entity: "dispatch", idempotencyKey }, async (session) => {
    if (!id) {
      const doc = await insertDraft(c, session, d);
      return { result: view(doc.toObject()), entityId: String(doc._id), audit: { number: doc.number } };
    }
    const doc = await loadForUpdate(c, id, session);
    if (doc.status !== "DRAFT") throw new AppError("INVALID_STATE", "This dispatch was already sent and can no longer be edited.");
    const dest = await Location.exists({ ...tf(c), _id: d.toLocationId, type: "STORE" }).session(session);
    if (!dest) throw new AppError("VALIDATION", "Pick one of your stores.");
    doc.set({ toLocationId: d.toLocationId, note: d.note, lines: mergeLines(d.lines) });
    await doc.save({ session });
    return { result: view(doc.toObject()), entityId: id, audit: { lines: d.lines.length } };
  });
}

export async function discardDraft(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "dispatch.discard_draft", entity: "dispatch", idempotencyKey }, async (session) => {
    const doc = await loadForUpdate(c, id, session);
    if (doc.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only drafts can be discarded.");
    await Dispatch.deleteOne({ _id: doc._id }, { session });
    if (doc.restockRequestId) {
      await RestockRequest.updateOne({ ...tf(c), _id: doc.restockRequestId, status: "APPROVED" }, { $set: { dispatchId: null } }, { session });
    }
    return { result: null, entityId: id, audit: { number: doc.number } };
  });
}

/* ---------- send ---------- */

/** DRAFT -> DISPATCHED: deducts Store Room stock (DISPATCH_OUT). The lines are now in transit to the store. */
export async function sendDispatch(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<DispatchView> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "dispatch.send", entity: "dispatch", idempotencyKey }, async (session) => {
    const doc = await loadForUpdate(c, id, session);
    if (doc.status !== "DRAFT") throw new AppError("INVALID_STATE", "This dispatch was already sent.");
    await applyMoves(
      c,
      session,
      doc.lines.map((l) => ({ productId: String(l.productId), locationId: String(doc.fromLocationId), delta: -l.quantity, type: "DISPATCH_OUT" as const })),
      { refType: "dispatch", refId: id },
    );
    doc.set({ status: "DISPATCHED", dispatchedAt: new Date(), dispatchedBy: c.userId });
    await doc.save({ session });
    if (doc.restockRequestId) {
      await RestockRequest.updateOne({ ...tf(c), _id: doc.restockRequestId }, { $set: { status: "DISPATCHED", dispatchId: doc._id } }, { session });
    }
    return { result: view(doc.toObject()), entityId: id, audit: { number: doc.number, pieces: doc.lines.reduce((s, l) => s + l.quantity, 0) } };
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
  return runMutation(c, { action: "dispatch.receive", entity: "dispatch", idempotencyKey }, async (session) => {
    const doc = await loadForUpdate(c, id, session);
    assertLocationAccess(c, String(doc.toLocationId));
    if (doc.status !== "DISPATCHED") throw new AppError("INVALID_STATE", "This dispatch is not waiting to be received.");
    const byId = new Map(d.lines.map((l) => [l.lineId, l]));
    if (byId.size !== doc.lines.length || doc.lines.some((l) => !byId.has(String(l._id)))) {
      throw new AppError("VALIDATION", "Enter the received quantity for every line.");
    }
    let issues = false;
    const moves: Move[] = [];
    for (const line of doc.lines) {
      const r = byId.get(String(line._id))!;
      if (r.receivedQty + r.missingQty + r.damagedQty !== line.quantity) {
        throw new AppError("VALIDATION", `Received + missing + damaged must add up to ${line.quantity} for every line.`);
      }
      if (r.missingQty + r.damagedQty > 0) {
        issues = true;
        if (!r.note) throw new AppError("VALIDATION", "Add a note for each line with missing or damaged pieces.");
      }
      line.receivedQty = r.receivedQty;
      line.missingQty = r.missingQty;
      line.damagedQty = r.damagedQty;
      line.note = r.note;
      if (r.receivedQty > 0) {
        moves.push({ productId: String(line.productId), locationId: String(doc.toLocationId), delta: r.receivedQty, type: "DISPATCH_IN" });
      }
    }
    await applyMoves(c, session, moves, { refType: "dispatch", refId: id });
    doc.set({ status: issues ? "RECEIVED_WITH_ISSUES" : "RECEIVED", receivedAt: new Date(), receivedBy: c.userId });
    await doc.save({ session });
    return { result: view(doc.toObject()), entityId: id, audit: { number: doc.number, issues } };
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
  return runMutation(c, { action: "dispatch.resolve_discrepancy", entity: "dispatch", idempotencyKey }, async (session) => {
    const doc = await loadForUpdate(c, id, session);
    if (doc.status !== "RECEIVED_WITH_ISSUES") throw new AppError("INVALID_STATE", "This dispatch has no open issues.");
    const line = doc.lines.find((l) => String(l._id) === d.lineId);
    if (!line) throw new AppError("NOT_FOUND", "Line not found.");
    const n = (line.missingQty ?? 0) + (line.damagedQty ?? 0);
    if (n === 0) throw new AppError("INVALID_STATE", "This line has no missing or damaged pieces.");
    if (line.resolution) throw new AppError("INVALID_STATE", "This line was already resolved.");
    const loc = String(doc.fromLocationId);
    const pid = String(line.productId);
    const note = d.note ?? `${doc.number} discrepancy`;
    const moves: Move[] = [{ productId: pid, locationId: loc, delta: n, type: "RETURN_IN", note }];
    if (d.action === "WRITE_OFF") moves.push({ productId: pid, locationId: loc, delta: -n, type: "DAMAGE", note: `Written off: ${note}` });
    await applyMoves(c, session, moves, { refType: "dispatch", refId: id });
    line.resolution = { action: d.action, by: c.userId as never, at: new Date(), note: d.note };
    const open = doc.lines.some((l) => (l.missingQty ?? 0) + (l.damagedQty ?? 0) > 0 && !l.resolution);
    if (!open) doc.status = "RESOLVED";
    await doc.save({ session });
    return { result: view(doc.toObject()), entityId: id, audit: { number: doc.number, lineId: d.lineId, action: d.action, pieces: n } };
  });
}

/* ---------- reads ---------- */

export async function listDispatches(
  ctx: Ctx | null,
  opts: { status?: DispatchStatus | DispatchStatus[]; toLocationId?: string; from?: Date; to?: Date; page?: number; pageSize?: number } = {},
) {
  const c = await guard(ctx, ALL);
  const filter: Record<string, unknown> = { ...visibilityFilter(c) };
  if (opts.status) {
    const st = Array.isArray(opts.status) ? opts.status : [opts.status];
    filter.status = c.role === "STORE_STAFF" ? { $in: st.filter((s) => s !== "DRAFT") } : { $in: st };
  }
  if (opts.toLocationId) {
    assertLocationAccess(c, opts.toLocationId);
    filter.toLocationId = opts.toLocationId;
  }
  if (opts.from || opts.to) filter.createdAt = { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lte: opts.to } : {}) };
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    Dispatch.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Dispatch.countDocuments(filter),
  ]);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getDispatch(ctx: Ctx | null, id: string): Promise<DispatchView> {
  const c = await guard(ctx, ALL);
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Dispatch not found.");
  const d = await Dispatch.findOne({ ...visibilityFilter(c), _id: id }).lean();
  if (!d) throw new AppError("NOT_FOUND", "Dispatch not found.");
  return view(d);
}
