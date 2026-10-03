import "server-only";
import { z } from "zod";
import { Sale, Product, type SaleDoc } from "../models/business";
import { Location } from "../models/core";
import { guard, tf, assertLocationAccess } from "../data/guard";
import { runMutation } from "../mutation";
import { AppError, isDuplicateKey } from "../errors";
import { connectDb } from "../db";
import { applyMoves } from "./core";
import { objectId } from "@/lib/validation";
import type { Ctx, TenantCtx } from "../context";

/*
 * Sales reduce a store's stock. Used by:
 *  - POST /api/v1/sales (billing module, per-tenant API key), and
 *  - recordSale() for in-system callers (signed-in OWNER or the store's STORE_STAFF).
 * Idempotent on (tenantId, externalRef): repeating a sale returns the first result and changes nothing.
 */

export const saleSchema = z.object({
  locationId: objectId,
  externalRef: z.string().trim().min(1, "externalRef is required").max(100),
  items: z
    .array(
      z.object({
        barcode: z.string().trim().min(1, "barcode is required").max(64),
        quantity: z.number().int("quantity must be a whole number").min(1, "quantity must be at least 1").max(10000),
      }),
    )
    .min(1, "items must not be empty")
    .max(500),
});
export type SaleInput = z.input<typeof saleSchema>;

export interface SaleResult {
  saleId: string;
  externalRef: string;
  locationId: string;
  duplicate: boolean;
  items: { barcode: string; productId: string; quantity: number; balanceAfter: number | null }[];
  createdAt: string;
}

const result = (s: SaleDoc, duplicate: boolean, balances?: Map<string, number>): SaleResult => ({
  saleId: String(s._id),
  externalRef: s.externalRef,
  locationId: String(s.locationId),
  duplicate,
  items: s.items.map((i) => ({ barcode: i.barcode, productId: String(i.productId), quantity: i.quantity, balanceAfter: balances?.get(String(i.productId)) ?? null })),
  createdAt: s.createdAt.toISOString(),
});

/** Core sale logic for an already-authorized tenant context. */
export async function applySale(c: TenantCtx, input: unknown, source: "API" | "INTERNAL"): Promise<SaleResult> {
  const d = saleSchema.parse(input);
  await connectDb();
  const existing = await Sale.findOne({ ...tf(c), externalRef: d.externalRef }).lean();
  if (existing) return result(existing, true);

  // Merge repeated barcodes.
  const qtyByBarcode = new Map<string, number>();
  for (const i of d.items) qtyByBarcode.set(i.barcode, (qtyByBarcode.get(i.barcode) ?? 0) + i.quantity);

  try {
    return await runMutation(c, { action: source === "API" ? "sale.api" : "sale.internal", entity: "sale" }, async (session) => {
      const loc = await Location.findOne({ ...tf(c), _id: d.locationId }).session(session).lean();
      if (!loc || loc.type !== "STORE") throw new AppError("INVALID_LOCATION", "locationId must be one of this shop's stores.", { locationId: d.locationId });
      const products = await Product.find({ ...tf(c), barcode: { $in: [...qtyByBarcode.keys()] } }, { barcode: 1 }).session(session).lean();
      const byBarcode = new Map(products.map((p) => [p.barcode, String(p._id)]));
      const unknown = [...qtyByBarcode.keys()].filter((b) => !byBarcode.has(b));
      if (unknown.length) throw new AppError("UNKNOWN_BARCODE", `Unknown barcode: ${unknown.join(", ")}`, { barcodes: unknown });

      const items = [...qtyByBarcode].map(([barcode, quantity]) => ({ barcode, quantity, productId: byBarcode.get(barcode)! }));
      const [sale] = await Sale.create([{ ...tf(c), locationId: d.locationId, externalRef: d.externalRef, source, items }], { session });
      const res = await applyMoves(
        c,
        session,
        items.map((i) => ({ productId: i.productId, locationId: d.locationId, delta: -i.quantity, type: "SALE" as const, note: d.externalRef })),
        { refType: "sale", refId: String(sale._id) },
      );
      const balances = new Map(res.map((r) => [r.productId, r.balanceAfter]));
      return { result: result(sale.toObject(), false, balances), entityId: String(sale._id), audit: { externalRef: d.externalRef, source, items: items.length } };
    });
  } catch (e) {
    // A concurrent request with the same externalRef won the race: return its result.
    if (isDuplicateKey(e) && (e as { keyPattern?: Record<string, unknown> }).keyPattern?.externalRef) {
      const prev = await Sale.findOne({ ...tf(c), externalRef: d.externalRef }).lean();
      if (prev) return result(prev, true);
    }
    throw e;
  }
}

/** In-system entry point for the billing module (signed-in user). STORE_STAFF can only sell from their own store. */
export async function recordSale(ctx: Ctx | null, input: unknown): Promise<SaleResult> {
  const c = await guard(ctx, ["OWNER", "STORE_STAFF"]);
  const loc = (input as { locationId?: unknown })?.locationId;
  if (typeof loc === "string") assertLocationAccess(c, loc);
  return applySale(c, input, "INTERNAL");
}
