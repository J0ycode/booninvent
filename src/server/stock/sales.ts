import "server-only";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { sales, products, locations } from "../db/schema";
import { guard, tf, assertLocationAccess } from "../data/guard";
import { runMutation } from "../mutation";
import { AppError, duplicateConstraint } from "../errors";
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

const result = (s: typeof sales.$inferSelect, duplicate: boolean, balances?: Map<string, number>): SaleResult => ({
  saleId: s.id,
  externalRef: s.externalRef,
  locationId: s.locationId,
  duplicate,
  items: s.items.map((i) => ({ barcode: i.barcode, productId: i.productId, quantity: i.quantity, balanceAfter: balances?.get(i.productId) ?? null })),
  createdAt: s.createdAt.toISOString(),
});

async function findSale(c: TenantCtx, externalRef: string) {
  const db = await getDb();
  const [s] = await db
    .select()
    .from(sales)
    .where(and(eq(sales.tenantId, c.tenantId), eq(sales.externalRef, externalRef)));
  return s;
}

/** Core sale logic for an already-authorized tenant context. */
export async function applySale(c: TenantCtx, input: unknown, source: "API" | "INTERNAL"): Promise<SaleResult> {
  const d = saleSchema.parse(input);
  const existing = await findSale(c, d.externalRef);
  if (existing) return result(existing, true);

  // Merge repeated barcodes.
  const qtyByBarcode = new Map<string, number>();
  for (const i of d.items) qtyByBarcode.set(i.barcode, (qtyByBarcode.get(i.barcode) ?? 0) + i.quantity);

  try {
    return await runMutation(c, { action: source === "API" ? "sale.api" : "sale.internal", entity: "sale" }, async (tx) => {
      const [loc] = await tx
        .select({ type: locations.type })
        .from(locations)
        .where(and(eq(locations.tenantId, c.tenantId), eq(locations.id, d.locationId)));
      if (!loc || loc.type !== "STORE") throw new AppError("INVALID_LOCATION", "locationId must be one of this shop's stores.", { locationId: d.locationId });
      const found = await tx
        .select({ id: products.id, barcode: products.barcode })
        .from(products)
        .where(and(eq(products.tenantId, c.tenantId), inArray(products.barcode, [...qtyByBarcode.keys()])));
      const byBarcode = new Map(found.map((p) => [p.barcode, p.id]));
      const unknown = [...qtyByBarcode.keys()].filter((b) => !byBarcode.has(b));
      if (unknown.length) throw new AppError("UNKNOWN_BARCODE", `Unknown barcode: ${unknown.join(", ")}`, { barcodes: unknown });

      const items = [...qtyByBarcode].map(([barcode, quantity]) => ({ barcode, quantity, productId: byBarcode.get(barcode)! }));
      const [sale] = await tx
        .insert(sales)
        .values({ ...tf(c), locationId: d.locationId, externalRef: d.externalRef, source, items })
        .returning();
      const res = await applyMoves(
        c,
        tx,
        items.map((i) => ({ productId: i.productId, locationId: d.locationId, delta: -i.quantity, type: "SALE" as const, note: d.externalRef })),
        { refType: "sale", refId: sale.id },
      );
      const balances = new Map(res.map((r) => [r.productId, r.balanceAfter]));
      return { result: result(sale, false, balances), entityId: sale.id, audit: { externalRef: d.externalRef, source, items: items.length } };
    });
  } catch (e) {
    // A concurrent request with the same externalRef won the race: return its result.
    if (duplicateConstraint(e) === "sales_tenant_external_ref_uq") {
      const prev = await findSale(c, d.externalRef);
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
