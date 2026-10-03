import "server-only";
import type { ClientSession } from "mongoose";
import { StockLevel, StockMovement, type MovementType } from "../models/stock";
import { Product } from "../models/business";
import { Location } from "../models/core";
import { AppError } from "../errors";
import type { TenantCtx } from "../context";

/*
 * THE ONLY place stock quantities change.
 * Every change runs inside the caller's transaction and appends a stockMovements row in that same transaction.
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
export async function applyMoves(ctx: TenantCtx, session: ClientSession, moves: Move[], ref: MoveRef) {
  if (!moves.length) return [];
  for (const m of moves) {
    if (!Number.isInteger(m.delta) || m.delta === 0) throw new AppError("VALIDATION", "Quantities must be whole pieces and not zero.");
  }

  // Every product and location must belong to this tenant.
  const productIds = [...new Set(moves.map((m) => m.productId))];
  const locationIds = [...new Set(moves.map((m) => m.locationId))];
  // Sequential on purpose: operations on one transaction session must not run in parallel.
  const products = await Product.find({ tenantId: ctx.tenantId, _id: { $in: productIds } }, { name: 1 }).session(session).lean();
  const locations = await Location.find({ tenantId: ctx.tenantId, _id: { $in: locationIds } }, { name: 1 }).session(session).lean();
  if (products.length !== productIds.length) throw new AppError("VALIDATION", "One of the products was not found.");
  if (locations.length !== locationIds.length) throw new AppError("VALIDATION", "One of the locations was not found.");
  const pName = new Map(products.map((p) => [String(p._id), p.name]));
  const lName = new Map(locations.map((l) => [String(l._id), l.name]));

  const results: { productId: string; locationId: string; balanceAfter: number }[] = [];
  for (const m of moves) {
    const key = { tenantId: ctx.tenantId, productId: m.productId, locationId: m.locationId };
    let balanceAfter: number;
    if (m.delta < 0) {
      const need = -m.delta;
      // Atomic conditional decrement: only succeeds if enough stock is there.
      const doc = await StockLevel.findOneAndUpdate(
        { ...key, quantity: { $gte: need } },
        { $inc: { quantity: m.delta } },
        { session, returnDocument: "after" },
      ).lean();
      if (!doc) {
        const cur = await StockLevel.findOne(key, { quantity: 1 }).session(session).lean();
        const have = cur?.quantity ?? 0;
        throw new AppError(
          "INSUFFICIENT_STOCK",
          `Not enough stock: ${pName.get(m.productId)} has ${have} at ${lName.get(m.locationId)}, but ${need} ${need === 1 ? "is" : "are"} needed.`,
          { productId: m.productId, locationId: m.locationId, available: have, requested: need },
        );
      }
      balanceAfter = doc.quantity;
    } else {
      const doc = await StockLevel.findOneAndUpdate(key, { $inc: { quantity: m.delta } }, { session, upsert: true, returnDocument: "after" }).lean();
      balanceAfter = doc!.quantity;
    }
    await StockMovement.create(
      [
        {
          ...key,
          type: m.type,
          quantityDelta: m.delta,
          balanceAfter,
          refType: ref.refType,
          refId: ref.refId,
          userId: ctx.userId,
          note: m.note,
        },
      ],
      { session },
    );
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
