import "server-only";
import { z } from "zod";
import type { ClientSession } from "mongoose";
import { ReturnDamageEntry, Product, type ReturnDamageDoc, type ReturnType } from "../models/business";
import { Location } from "../models/core";
import { StockLevel } from "../models/stock";
import { guard, tf, staffLocationId, assertLocationAccess } from "../data/guard";
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
const view = (e: ReturnDamageDoc): ReturnEntryView => ({
  id: String(e._id),
  locationId: String(e.locationId),
  type: e.type,
  productId: String(e.productId),
  quantity: e.quantity,
  reason: e.reason,
  status: e.status,
  decisionNote: e.decisionNote,
  createdAt: e.createdAt.toISOString(),
  decidedAt: e.decidedAt?.toISOString() ?? null,
});

export const TYPE_LABEL: Record<ReturnType, string> = {
  RETURN_TO_STOREROOM: "Return to Store Room",
  DAMAGED: "Damaged (write off)",
  SUPPLIER_RETURN: "Return to supplier",
};

/** Stock moves for an approved entry. */
async function movesFor(c: TenantCtx, e: { type: ReturnType; locationId: string; productId: string; quantity: number; reason: string }, session: ClientSession): Promise<Move[]> {
  const note = e.reason;
  if (e.type === "RETURN_TO_STOREROOM") {
    const sr = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).session(session).lean();
    if (!sr) throw new AppError("NOT_FOUND", "Store Room not found.");
    return [
      { productId: e.productId, locationId: e.locationId, delta: -e.quantity, type: "RETURN_OUT", note },
      { productId: e.productId, locationId: String(sr._id), delta: e.quantity, type: "RETURN_IN", note },
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

  return runMutation(c, { action: isStaff ? "returns.request" : "returns.record", entity: "returnDamageEntry", idempotencyKey }, async (session) => {
    let locationId: string;
    if (isStaff) locationId = staffLocationId(c);
    else {
      const sr = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).session(session).lean();
      if (!sr) throw new AppError("NOT_FOUND", "Store Room not found.");
      locationId = String(sr._id);
    }
    const n = await Product.countDocuments({ ...tf(c), _id: { $in: lines.map((l) => l.productId) } }).session(session);
    if (n !== lines.length) throw new AppError("VALIDATION", "One of the products was not found.");

    if (isStaff) {
      // Friendly early check; the real guarantee is the conditional decrement on approval.
      for (const l of lines) {
        const lvl = await StockLevel.findOne({ ...tf(c), productId: l.productId, locationId }).session(session).lean();
        if ((lvl?.quantity ?? 0) < l.quantity) throw new AppError("INSUFFICIENT_STOCK", `You only have ${lvl?.quantity ?? 0} of one of these products.`);
      }
    }
    const now = new Date();
    const docs = await ReturnDamageEntry.create(
      lines.map((l) => ({
        ...tf(c),
        locationId,
        type: d.type,
        productId: l.productId,
        quantity: l.quantity,
        reason: d.reason,
        status: isStaff ? "PENDING" : "APPROVED",
        createdBy: c.userId,
        ...(isStaff ? {} : { decidedBy: c.userId, decidedAt: now, decisionNote: "Recorded by Store Room" }),
      })),
      { session, ordered: true },
    );
    if (!isStaff) {
      for (const e of docs) {
        await applyMoves(c, session, await movesFor(c, { type: d.type, locationId, productId: String(e.productId), quantity: e.quantity, reason: d.reason }, session), {
          refType: "returnDamage",
          refId: String(e._id),
        });
      }
    }
    return { result: docs.map((e) => view(e.toObject())), entityId: String(docs[0]._id), audit: { type: d.type, lines: lines.length, applied: !isStaff } };
  });
}

/** Approve a pending store entry: stock changes now (RETURN_OUT + RETURN_IN, or DAMAGE). */
export async function approveEntry(ctx: Ctx | null, id: string, idempotencyKey?: string): Promise<ReturnEntryView> {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "returns.approve", entity: "returnDamageEntry", idempotencyKey }, async (session) => {
    const e = await ReturnDamageEntry.findOne({ ...tf(c), _id: id }).session(session);
    if (!e) throw new AppError("NOT_FOUND", "Entry not found.");
    if (e.status !== "PENDING") throw new AppError("INVALID_STATE", "This entry was already decided.");
    await applyMoves(
      c,
      session,
      await movesFor(c, { type: e.type, locationId: String(e.locationId), productId: String(e.productId), quantity: e.quantity, reason: e.reason }, session),
      { refType: "returnDamage", refId: id },
    );
    e.set({ status: "APPROVED", decidedBy: c.userId, decidedAt: new Date() });
    await e.save({ session });
    return { result: view(e.toObject()), entityId: id, audit: { type: e.type, quantity: e.quantity } };
  });
}

export async function rejectEntry(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<ReturnEntryView> {
  const c = await guard(ctx, MANAGERS);
  const { note } = z.object({ note: z.string().trim().min(2, "Give a short reason").max(300) }).parse(input);
  return runMutation(c, { action: "returns.reject", entity: "returnDamageEntry", idempotencyKey }, async (session) => {
    const e = await ReturnDamageEntry.findOne({ ...tf(c), _id: id }).session(session);
    if (!e) throw new AppError("NOT_FOUND", "Entry not found.");
    if (e.status !== "PENDING") throw new AppError("INVALID_STATE", "This entry was already decided.");
    e.set({ status: "REJECTED", decidedBy: c.userId, decidedAt: new Date(), decisionNote: note });
    await e.save({ session });
    return { result: view(e.toObject()), entityId: id, audit: { note } };
  });
}

export async function listEntries(
  ctx: Ctx | null,
  opts: { status?: "PENDING" | "APPROVED" | "REJECTED"; locationId?: string; type?: ReturnType; from?: Date; to?: Date; page?: number; pageSize?: number } = {},
) {
  const c = await guard(ctx, ALL);
  const filter: Record<string, unknown> = { ...tf(c) };
  if (c.role === "STORE_STAFF") filter.locationId = { $in: c.locationIds };
  if (opts.locationId) {
    assertLocationAccess(c, opts.locationId);
    filter.locationId = opts.locationId;
  }
  if (opts.status) filter.status = opts.status;
  if (opts.type) filter.type = opts.type;
  if (opts.from || opts.to) filter.createdAt = { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lte: opts.to } : {}) };
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    ReturnDamageEntry.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    ReturnDamageEntry.countDocuments(filter),
  ]);
  return { rows: rows.map(view), total, page, pageSize };
}
