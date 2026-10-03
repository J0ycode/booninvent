import "server-only";
import { z } from "zod";
import { and, count, desc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "../db";
import { receipts, suppliers, productCosts, locations } from "../db/schema";
import { guard, tf, assertId } from "../data/guard";
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
const view = (r: typeof receipts.$inferSelect): ReceiptView => ({
  id: r.id,
  number: r.number,
  supplierId: r.supplierId,
  invoiceNumber: r.invoiceNumber,
  note: r.note ?? undefined,
  lines: r.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, cost: l.cost ?? null })),
  totalPieces: r.lines.reduce((s, l) => s + l.quantity, 0),
  createdBy: r.createdBy,
  createdAt: r.createdAt.toISOString(),
});

/** Supplier -> Store Room. Adds stock (RECEIPT movements) and records the receipt. Optional cost updates the product's cost price. */
export async function receiveStock(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<ReceiptView> {
  const c = await guard(ctx, MANAGERS);
  const d = receiveSchema.parse(input);
  const lines = mergeLines(d.lines);
  return runMutation(c, { action: "stock.receive", entity: "receipt", idempotencyKey }, async (tx) => {
    const [supplier] = await tx
      .select({ name: suppliers.name })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, c.tenantId), eq(suppliers.id, d.supplierId)));
    const [storeRoom] = await tx
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.tenantId, c.tenantId), eq(locations.type, "STORE_ROOM")));
    if (!supplier) throw new AppError("VALIDATION", "Pick one of your suppliers.");
    if (!storeRoom) throw new AppError("NOT_FOUND", "Store Room not found.");
    const number = docNumber("RCV", await nextSeq(c.tenantId, "receipt", tx));
    const [r] = await tx
      .insert(receipts)
      .values({ ...tf(c), number, supplierId: d.supplierId, invoiceNumber: d.invoiceNumber, locationId: storeRoom.id, lines, note: d.note, createdBy: c.userId })
      .returning();
    await applyMoves(
      c,
      tx,
      lines.map((l) => ({ productId: l.productId, locationId: storeRoom.id, delta: l.quantity, type: "RECEIPT" as const })),
      { refType: "receipt", refId: r.id },
    );
    for (const l of lines) {
      if (l.cost === null) continue;
      await tx
        .insert(productCosts)
        .values({ ...tf(c), productId: l.productId, costPrice: l.cost })
        .onConflictDoUpdate({ target: [productCosts.tenantId, productCosts.productId], set: { costPrice: l.cost, updatedAt: new Date() } });
    }
    return { result: view(r), entityId: r.id, audit: { number, supplier: supplier.name, invoiceNumber: d.invoiceNumber, lines: lines.length } };
  });
}

export async function listReceipts(ctx: Ctx | null, opts: { page?: number; pageSize?: number; from?: Date; to?: Date } = {}) {
  const c = await guard(ctx, MANAGERS);
  const where = and(
    eq(receipts.tenantId, c.tenantId),
    opts.from ? gte(receipts.createdAt, opts.from) : undefined,
    opts.to ? lte(receipts.createdAt, opts.to) : undefined,
  );
  const pageSize = Math.min(opts.pageSize ?? 25, 100);
  const page = Math.max(opts.page ?? 1, 1);
  const db = await getDb();
  const rows = await db
    .select()
    .from(receipts)
    .where(where)
    .orderBy(desc(receipts.createdAt), desc(receipts.number))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(receipts).where(where);
  return { rows: rows.map(view), total, page, pageSize };
}

export async function getReceipt(ctx: Ctx | null, id: string): Promise<ReceiptView> {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Receipt not found.");
  const db = await getDb();
  const [r] = await db
    .select()
    .from(receipts)
    .where(and(eq(receipts.tenantId, c.tenantId), eq(receipts.id, id)));
  if (!r) throw new AppError("NOT_FOUND", "Receipt not found.");
  return view(r);
}
