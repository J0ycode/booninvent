import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { stockLevels, stockMovements } from "../db/stock-schema";
import { products, locations } from "../db/schema";
import type { MovementType } from "../db/types";
import { AppError } from "../errors";
import type { TenantCtx } from "../context";

/*
 * THE ONLY place stock quantities change.
 * Every change runs inside the caller's transaction and appends a stock_movements row in that same transaction.
 */

export interface Move {
  productId: string;
  locationId: string;
  delta: number; // + adds, - removes
  type: MovementType;
  note?: string;
}

export interface MoveRef {
  refType: string; // e.g. "receipt", "dispatch", "sale"
  refId: string;
}

/** Applies moves in order. Throws INSUFFICIENT_STOCK (and the transaction rolls back) if any decrement would go negative. */
export async function applyMoves(ctx: TenantCtx, tx: Tx, moves: Move[], ref: MoveRef) {
  if (!moves.length) return [];
  for (const m of moves) {
    if (!Number.isInteger(m.delta) || m.delta === 0) throw new AppError("VALIDATION", "Quantities must be whole pieces and not zero.");
  }

  // Every product and location must belong to this tenant.
  const productIds = [...new Set(moves.map((m) => m.productId))];
  const locationIds = [...new Set(moves.map((m) => m.locationId))];
  // Sequential on purpose: queries on one transaction run one after another.
  const productRows = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, productIds)));
  const locationRows = await tx
    .select({ id: locations.id, name: locations.name })
    .from(locations)
    .where(and(eq(locations.tenantId, ctx.tenantId), inArray(locations.id, locationIds)));
  if (productRows.length !== productIds.length) throw new AppError("VALIDATION", "One of the products was not found.");
  if (locationRows.length !== locationIds.length) throw new AppError("VALIDATION", "One of the locations was not found.");
  const pName = new Map(productRows.map((p) => [p.id, p.name]));
  const lName = new Map(locationRows.map((l) => [l.id, l.name]));

  const results: { productId: string; locationId: string; balanceAfter: number }[] = [];
  for (const m of moves) {
    const key = { tenantId: ctx.tenantId, productId: m.productId, locationId: m.locationId };
    const at = and(eq(stockLevels.tenantId, key.tenantId), eq(stockLevels.productId, key.productId), eq(stockLevels.locationId, key.locationId));
    let balanceAfter: number;
    if (m.delta < 0) {
      const need = -m.delta;
      // Atomic conditional decrement: only succeeds if enough stock is there (the row is locked until commit).
      const [row] = await tx
        .update(stockLevels)
        .set({ quantity: sql`${stockLevels.quantity} + ${m.delta}`, updatedAt: new Date() })
        .where(and(at, gte(stockLevels.quantity, need)))
        .returning({ quantity: stockLevels.quantity });
      if (!row) {
        const [cur] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels).where(at);
        const have = cur?.quantity ?? 0;
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Not enough stock: ${pName.get(m.productId)} has ${have} at ${lName.get(m.locationId)}, but ${need} ${need === 1 ? "is" : "are"} needed.`,
          { productId: m.productId, locationId: m.locationId, available: have, requested: need },
        );
      }
      balanceAfter = row.quantity;
    } else {
      const [row] = await tx
        .insert(stockLevels)
        .values({ ...key, quantity: m.delta })
        .onConflictDoUpdate({
          target: [stockLevels.tenantId, stockLevels.productId, stockLevels.locationId],
          set: { quantity: sql`${stockLevels.quantity} + ${m.delta}`, updatedAt: new Date() },
        })
        .returning({ quantity: stockLevels.quantity });
      balanceAfter = row.quantity;
    }
    await tx.insert(stockMovements).values({
      ...key,
      type: m.type,
      quantityDelta: m.delta,
      balanceAfter,
      refType: ref.refType,
      refId: ref.refId,
      userId: ctx.userId || null, // empty for API-key (machine) calls
      note: m.note,
    });
    results.push({ productId: m.productId, locationId: m.locationId, balanceAfter });
  }
  return results;
}

/** Sum duplicate product lines so a document never lists the same product twice. */
export function mergeLines<T extends { productId: string; quantity: number }>(lines: T[]): T[] {
  const map = new Map<string, T>();
  for (const l of lines) {
    const prev = map.get(l.productId);
    if (prev) prev.quantity += l.quantity;
    else map.set(l.productId, { ...l });
  }
  return [...map.values()];
}
