import "server-only";
import { z } from "zod";
import { Receipt, Supplier, ProductCost, type ReceiptDoc } from "../models/business";
import { Location } from "../models/core";
import { guard, tf } from "../data/guard";
import { runMutation, nextSeq, docNumber } from "../mutation";
import { AppError } from "../errors";
import { applyMoves, mergeLines } from "./core";
import { objectId, qty } from "@/lib/validation";
import type { Ctx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

export const receiveSchema = z.object({
  supplierId: objectId,
  invoiceNumber: z.string().trim().min(1, "Enter the supplier invoice number").max(60),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: objectId,
        quantity: qty,
        cost: z
          .union([z.number().int().min(0), z.null()])
          .optional()
          .transform((v) => v ?? null), // paise
      }),
    )
    .min(1, "Add at least one product")
    .max(500, "Up to 500 lines per receipt"),
});

export interface ReceiptView {
  id: string;
  number: string;
  supplierId: string;
  invoiceNumber: string;
  note?: string;
  lines: { productId: string; quantity: number; cost: number | null }[];
  totalPieces: number;
  createdBy: string;
  createdAt: string;
}
const view = (r: ReceiptDoc): ReceiptView => ({
  id: String(r._id),
  number: r.number,
  supplierId: String(r.supplierId),
  invoiceNumber: r.invoiceNumber,
  note: r.note,
  lines: r.lines.map((l) => ({ productId: String(l.productId), quantity: l.quantity, cost: l.cost ?? null })),
  totalPieces: r.lines.reduce((s, l) => s + l.quantity, 0),
  createdBy: String(r.createdBy),
  createdAt: r.createdAt.toISOString(),
});

/** Supplier -> Store Room. Adds stock (RECEIPT movements) and records the receipt. Optional cost updates the product's cost price. */
export async function receiveStock(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<ReceiptView> {
  const c = await guard(ctx, MANAGERS);
  const d = receiveSchema.parse(input);
  const lines = mergeLines(d.lines);
  return runMutation(c, { action: "stock.receive", entity: "receipt", idempotencyKey }, async (session) => {
    const supplier = await Supplier.findOne({ ...tf(c), _id: d.supplierId }).session(session).lean();
    const storeRoom = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).session(session).lean();
    if (!supplier) throw new AppError("VALIDATION", "Pick one of your suppliers.");
    if (!storeRoom) throw new AppError("NOT_FOUND", "Store Room not found.");
    const number = docNumber("RCV", await nextSeq(c.tenantId, "receipt", session));
    const [r] = await Receipt.create(
      [{ ...tf(c), number, supplierId: d.supplierId, invoiceNumber: d.invoiceNumber, locationId: storeRoom._id, lines, note: d.note, createdBy: c.userId }],
      { session },
    );
    await applyMoves(
      c,
      session,
      lines.map((l) => ({ productId: l.productId, locationId: String(storeRoom._id), delta: l.quantity, type: "RECEIPT" as const })),
      { refType: "receipt", refId: String(r._id) },
    );
    for (const l of lines) {
      if (l.cost !== null) await ProductCost.updateOne({ ...tf(c), productId: l.productId }, { $set: { costPrice: l.cost } }, { upsert: true, session });
    }
    return { result: view(r.toObject()), entityId: String(r._id), audit: { number, supplier: supplier.name, invoiceNumber: d.invoiceNumber, lines: lines.length } };
  });
}

export async function listReceipts(ctx: Ctx | null, opts: { page?: number; pageSize?: number; from?: Date; to?: Date } = {}) {
  const c = await guard(ctx, MANAGERS);
  const filter: Record<string, unknown> = { ...tf(c) };
  if (opts.from || opts.to) filter.createdAt = { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lte: opts.to } : {}) };
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const [rows, total] = await Promise.all([
    Receipt.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Receipt.countDocuments(filter),
  ]);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getReceipt(ctx: Ctx | null, id: string): Promise<ReceiptView> {
  const c = await guard(ctx, MANAGERS);
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Receipt not found.");
  const r = await Receipt.findOne({ ...tf(c), _id: id }).lean();
  if (!r) throw new AppError("NOT_FOUND", "Receipt not found.");
  return view(r);
}
