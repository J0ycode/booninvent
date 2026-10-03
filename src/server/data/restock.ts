import "server-only";
import { z } from "zod";
import type { ClientSession } from "mongoose";
import { RestockRequest, type RestockDoc, type RestockStatus } from "../models/business";
import { Product } from "../models/business";
import { guard, tf, staffLocationId, assertLocationAccess } from "./guard";
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

function view(r: RestockDoc): RestockView {
  const lines = r.lines.map((l) => ({
    id: String(l._id),
    productId: String(l.productId),
    quantity: l.quantity,
    suggestedQty: l.suggestedQty ?? null,
    lineStatus: l.lineStatus,
  }));
  return {
    id: String(r._id),
    number: r.number,
    locationId: String(r.locationId),
    source: r.source,
    status: r.status,
    note: r.note,
    rejectReason: r.rejectReason,
    dispatchId: r.dispatchId ? String(r.dispatchId) : null,
    lines,
    approvedPieces: lines.filter((l) => l.lineStatus === "APPROVED").reduce((s, l) => s + l.quantity, 0),
    pendingLines: lines.filter((l) => l.lineStatus === "PENDING").length,
    createdAt: r.createdAt.toISOString(),
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

function visibility(c: TenantCtx): Record<string, unknown> {
  if (c.role === "STORE_STAFF") return { ...tf(c), locationId: { $in: c.locationIds } };
  return { ...tf(c), status: { $in: VISIBLE_TO_STOREROOM } };
}

async function load(c: TenantCtx, id: string, session: ClientSession) {
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Request not found.");
  const r = await RestockRequest.findOne({ ...visibility(c), _id: id }).session(session);
  if (!r) throw new AppError("NOT_FOUND", "Request not found.");
  return r;
}

async function assertActiveProducts(c: TenantCtx, ids: string[], session: ClientSession) {
  const n = await Product.countDocuments({ ...tf(c), _id: { $in: ids }, active: true }).session(session);
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
  return runMutation(c, { action: "restock.create_manual", entity: "restockRequest", idempotencyKey }, async (session) => {
    const lines = mergeLines(d.lines);
    await assertActiveProducts(
      c,
      lines.map((l) => l.productId),
      session,
    );
    const number = docNumber("REQ", await nextSeq(c.tenantId, "restock", session));
    const [r] = await RestockRequest.create(
      [
        {
          ...tf(c),
          number,
          locationId,
          source: "MANUAL",
          status: "SENT",
          sentAt: new Date(),
          note: d.note,
          lines: lines.map((l) => ({ ...l, suggestedQty: null, lineStatus: "APPROVED" })),
          createdBy: c.userId,
        },
      ],
      { session },
    );
    return { result: view(r.toObject()), entityId: String(r._id), audit: { number, lines: lines.length } };
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
  return runMutation(c, { action: "restock.suggest", entity: "restockRequest", idempotencyKey }, async (session) => {
    await RestockRequest.deleteMany({ ...tf(c), locationId, status: "WAITING_STAFF_APPROVAL" }, { session });
    const number = docNumber("REQ", await nextSeq(c.tenantId, "restock", session));
    const lines = low.map((l) => {
      const suggested = Math.max(1, l.reorderLevel * 2 - l.quantity);
      return { productId: l.productId, quantity: suggested, suggestedQty: suggested, lineStatus: "PENDING" as const };
    });
    const [r] = await RestockRequest.create(
      [{ ...tf(c), number, locationId, source: "SUGGESTED", status: "WAITING_STAFF_APPROVAL", lines, createdBy: c.userId }],
      { session },
    );
    return { result: view(r.toObject()), entityId: String(r._id), audit: { number, lines: lines.length } };
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
  return runMutation(c, { action: "restock.decide_line", entity: "restockRequest", idempotencyKey }, async (session) => {
    const r = await load(c, id, session);
    if (r.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "This request was already forwarded.");
    const line = r.lines.find((l) => String(l._id) === d.lineId);
    if (!line) throw new AppError("NOT_FOUND", "Line not found.");
    line.lineStatus = d.action === "APPROVE" ? "APPROVED" : "SKIPPED";
    if (d.action === "APPROVE" && d.quantity) line.quantity = d.quantity;
    await r.save({ session });
    return { result: view(r.toObject()), entityId: id, audit: d };
  });
}

/** Sends a reviewed suggestion to the Store Room. Every line must be approved or skipped first. */
export async function forwardRequest(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, ["STORE_STAFF"]);
  return runMutation(c, { action: "restock.forward", entity: "restockRequest", idempotencyKey }, async (session) => {
    const r = await load(c, id, session);
    if (r.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "This request was already forwarded.");
    if (r.lines.some((l) => l.lineStatus === "PENDING")) throw new AppError("VALIDATION", "Approve, edit or skip every line before forwarding.");
    if (!r.lines.some((l) => l.lineStatus === "APPROVED")) throw new AppError("VALIDATION", "Approve at least one line, or discard the suggestion.");
    r.set({ status: "SENT", sentAt: new Date() });
    await r.save({ session });
    return { result: view(r.toObject()), entityId: id, audit: { number: r.number } };
  });
}

export async function discardSuggestion(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, ["STORE_STAFF"]);
  return runMutation(c, { action: "restock.discard", entity: "restockRequest", idempotencyKey }, async (session) => {
    const r = await load(c, id, session);
    if (r.status !== "WAITING_STAFF_APPROVAL") throw new AppError("INVALID_STATE", "Only an unforwarded suggestion can be discarded.");
    await RestockRequest.deleteOne({ _id: r._id }, { session });
    return { result: null, entityId: id, audit: { number: r.number } };
  });
}

/* ---------- Store Room ---------- */

/** Approve: creates a pre-filled DRAFT dispatch with the approved lines, in one step. */
export async function approveRequest(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<{ request: RestockView; dispatchId: string }> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "restock.approve", entity: "restockRequest", idempotencyKey }, async (session) => {
    const r = await load(c, id, session);
    if (r.status !== "SENT") throw new AppError("INVALID_STATE", "Only sent requests can be approved.");
    const lines = r.lines.filter((l) => l.lineStatus === "APPROVED" && l.quantity > 0).map((l) => ({ productId: String(l.productId), quantity: l.quantity }));
    const draft = await insertDraft(c, session, { toLocationId: String(r.locationId), lines, note: `From request ${r.number}` }, String(r._id));
    r.set({ status: "APPROVED", decidedBy: c.userId, decidedAt: new Date(), dispatchId: draft._id });
    await r.save({ session });
    return { result: { request: view(r.toObject()), dispatchId: String(draft._id) }, entityId: id, audit: { number: r.number, dispatch: draft.number } };
  });
}

export async function rejectRequest(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<RestockView> {
  const c = await guard(ctx, MANAGERS);
  const { reason } = z.object({ reason: z.string().trim().min(2, "Give a short reason").max(300) }).parse(input);
  return runMutation(c, { action: "restock.reject", entity: "restockRequest", idempotencyKey }, async (session) => {
    const r = await load(c, id, session);
    if (r.status !== "SENT") throw new AppError("INVALID_STATE", "Only sent requests can be rejected.");
    r.set({ status: "REJECTED", rejectReason: reason, decidedBy: c.userId, decidedAt: new Date() });
    await r.save({ session });
    return { result: view(r.toObject()), entityId: id, audit: { number: r.number, reason } };
  });
}

/* ---------- reads ---------- */

export async function listRequests(ctx: Ctx | null, opts: { status?: RestockStatus; locationId?: string; page?: number; pageSize?: number } = {}) {
  const c = await guard(ctx, ALL);
  const filter: Record<string, unknown> = { ...visibility(c) };
  if (opts.status) {
    if (c.role !== "STORE_STAFF" && !VISIBLE_TO_STOREROOM.includes(opts.status)) return { rows: [], total: 0, page: 1, pageSize: 25 };
    filter.status = opts.status;
  }
  if (opts.locationId) {
    assertLocationAccess(c, opts.locationId);
    filter.locationId = opts.locationId;
  }
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    RestockRequest.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    RestockRequest.countDocuments(filter),
  ]);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getRequest(ctx: Ctx | null, id: string): Promise<RestockView> {
  const c = await guard(ctx, ALL);
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Request not found.");
  const r = await RestockRequest.findOne({ ...visibility(c), _id: id }).lean();
  if (!r) throw new AppError("NOT_FOUND", "Request not found.");
  return view(r);
}
