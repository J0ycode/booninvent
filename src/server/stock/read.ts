import "server-only";
import { Types } from "mongoose";
import { StockLevel, StockMovement, type MovementType } from "../models/stock";
import { Product } from "../models/business";
import { guard, tf, assertLocationAccess } from "../data/guard";
import type { Ctx, TenantCtx } from "../context";

/* Read-only stock queries. They live here because only src/server/stock may import the stock models. */

const ALL_ROLES = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;

/** Locations this user may see stock for (STORE_STAFF: own store only). */
function visibleLocations(ctx: TenantCtx, locationIds?: string[]): string[] | null {
  if (ctx.role === "STORE_STAFF") {
    const ids = locationIds?.length ? locationIds : ctx.locationIds;
    ids.forEach((id) => assertLocationAccess(ctx, id));
    return ids;
  }
  return locationIds?.length ? locationIds : null;
}

/** Map productId -> locationId -> quantity. */
export async function getLevels(ctx: Ctx | null, productIds: string[], locationIds?: string[]) {
  const c = await guard(ctx, ALL_ROLES);
  const locs = visibleLocations(c, locationIds);
  const rows = await StockLevel.find({
    ...tf(c),
    productId: { $in: productIds },
    ...(locs ? { locationId: { $in: locs } } : {}),
  }).lean();
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) (out[String(r.productId)] ??= {})[String(r.locationId)] = r.quantity;
  return out;
}

/** Totals for dashboards: pieces at a location, and products with quantity > 0. */
export async function locationTotals(ctx: Ctx | null, locationId: string) {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  const [r] = await StockLevel.aggregate<{ pieces: number; skus: number }>([
    { $match: { tenantId: new Types.ObjectId(c.tenantId), locationId: new Types.ObjectId(locationId) } },
    { $group: { _id: null, pieces: { $sum: "$quantity" }, skus: { $sum: { $cond: [{ $gt: ["$quantity", 0] }, 1, 0] } } } },
  ]);
  return { pieces: r?.pieces ?? 0, skus: r?.skus ?? 0 };
}

export interface MovementView {
  id: string;
  productId: string;
  locationId: string;
  type: MovementType;
  quantityDelta: number;
  balanceAfter: number;
  refType: string;
  refId: string;
  userId: string | null;
  note?: string;
  createdAt: string;
}

/** Ledger rows, newest first. STORE_STAFF only see their store. */
export async function listMovements(
  ctx: Ctx | null,
  opts: { locationId?: string; productId?: string; types?: MovementType[]; from?: Date; to?: Date; page?: number; pageSize?: number },
) {
  const c = await guard(ctx, ALL_ROLES);
  const locs = visibleLocations(c, opts.locationId ? [opts.locationId] : undefined);
  const filter: Record<string, unknown> = { ...tf(c) };
  if (locs) filter.locationId = { $in: locs };
  if (opts.productId) filter.productId = opts.productId;
  if (opts.types?.length) filter.type = { $in: opts.types };
  if (opts.from || opts.to) filter.createdAt = { ...(opts.from ? { $gte: opts.from } : {}), ...(opts.to ? { $lte: opts.to } : {}) };
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(1, opts.page ?? 1);
  const [rows, total] = await Promise.all([
    StockMovement.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    StockMovement.countDocuments(filter),
  ]);
  return {
    total,
    page,
    pageSize,
    rows: rows.map(
      (m): MovementView => ({
        id: String(m._id),
        productId: String(m.productId),
        locationId: String(m.locationId),
        type: m.type,
        quantityDelta: m.quantityDelta,
        balanceAfter: m.balanceAfter,
        refType: m.refType,
        refId: m.refId,
        userId: m.userId ? String(m.userId) : null,
        note: m.note,
        createdAt: m.createdAt.toISOString(),
      }),
    ),
  };
}

/** Product ids at a location filtered by quantity (for low-stock lists and "My Stock"). */
export async function levelsAtLocation(
  ctx: Ctx | null,
  locationId: string,
  opts: { productIds?: string[]; maxQty?: number } = {},
): Promise<{ productId: string; quantity: number }[]> {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  const filter: Record<string, unknown> = { ...tf(c), locationId };
  if (opts.productIds) filter.productId = { $in: opts.productIds };
  if (opts.maxQty !== undefined) filter.quantity = { $lte: opts.maxQty };
  const rows = await StockLevel.find(filter, { productId: 1, quantity: 1 }).lean();
  return rows.map((r) => ({ productId: String(r.productId), quantity: r.quantity }));
}

/**
 * Store products at or below their reorder level (only products the store has carried: a stock row exists).
 * Uses $lookup into products, so it lives with the other stock reads.
 */
export async function lowStockAt(ctx: Ctx | null, locationId: string): Promise<{ productId: string; quantity: number; reorderLevel: number }[]> {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  const rows = await StockLevel.aggregate<{ productId: Types.ObjectId; quantity: number; reorderLevel: number }>([
    { $match: { tenantId: new Types.ObjectId(c.tenantId), locationId: new Types.ObjectId(locationId) } },
    { $lookup: { from: "products", localField: "productId", foreignField: "_id", as: "p", pipeline: [{ $project: { reorderLevel: 1, active: 1 } }] } },
    { $unwind: "$p" },
    { $match: { "p.active": true, "p.reorderLevel": { $gt: 0 }, $expr: { $lte: ["$quantity", "$p.reorderLevel"] } } },
    { $project: { productId: 1, quantity: 1, reorderLevel: "$p.reorderLevel" } },
  ]);
  return rows.map((r) => ({ productId: String(r.productId), quantity: r.quantity, reorderLevel: r.reorderLevel }));
}

/** Count of low-stock products per location, for dashboards. */
export async function lowStockCount(ctx: Ctx | null, locationId: string) {
  return (await lowStockAt(ctx, locationId)).length;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface StockRow {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  category: "CLOTHING" | "ACCESSORY";
  sellingPrice: number;
  reorderLevel: number;
  quantity: number;
}

/**
 * Stock at one location, searchable and paginated, starting from products.
 * includeUnstocked: also list active products with no stock row (quantity 0), used for the Store Room.
 * low: only quantity <= reorderLevel (and reorderLevel > 0).
 */
export async function stockAtLocation(
  ctx: Ctx | null,
  locationId: string,
  opts: { q?: string; low?: boolean; includeUnstocked?: boolean; page?: number; pageSize?: number } = {},
) {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  const tenantId = new Types.ObjectId(c.tenantId);
  const loc = new Types.ObjectId(locationId);
  const pageSize = Math.min(opts.pageSize ?? 25, 10000);
  const page = Math.max(opts.page ?? 1, 1);
  const match: Record<string, unknown> = { tenantId, active: true };
  const q = opts.q?.trim();
  if (q) match.$or = [{ barcode: q }, { sku: { $regex: `^${escapeRe(q)}`, $options: "i" } }, { nameLower: { $regex: escapeRe(q.toLowerCase()) } }];
  const pipeline: Record<string, unknown>[] = [
    { $match: match },
    { $lookup: { from: "stocklevels", let: { pid: "$_id" }, pipeline: [{ $match: { $expr: { $and: [{ $eq: ["$productId", "$$pid"] }, { $eq: ["$locationId", loc] }, { $eq: ["$tenantId", tenantId] }] } } }, { $project: { quantity: 1 } }], as: "lvl" } },
    { $addFields: { carried: { $gt: [{ $size: "$lvl" }, 0] }, quantity: { $ifNull: [{ $first: "$lvl.quantity" }, 0] } } },
  ];
  if (!opts.includeUnstocked) pipeline.push({ $match: { carried: true } });
  if (opts.low) pipeline.push({ $match: { reorderLevel: { $gt: 0 }, $expr: { $lte: ["$quantity", "$reorderLevel"] } } });
  pipeline.push({
    $facet: {
      rows: [{ $sort: { nameLower: 1, _id: 1 } }, { $skip: (page - 1) * pageSize }, { $limit: pageSize }],
      total: [{ $count: "n" }],
      sum: [{ $group: { _id: null, pieces: { $sum: "$quantity" } } }],
    },
  });
  const [res] = await Product.aggregate<{
    rows: (StockRow & { _id: Types.ObjectId })[];
    total: { n: number }[];
    sum: { pieces: number }[];
  }>(pipeline as never);
  return {
    rows: res.rows.map(
      (r): StockRow => ({
        productId: String(r._id),
        name: r.name,
        sku: r.sku,
        barcode: r.barcode,
        category: r.category,
        sellingPrice: r.sellingPrice,
        reorderLevel: r.reorderLevel,
        quantity: r.quantity,
      }),
    ),
    total: res.total[0]?.n ?? 0,
    pieces: res.sum[0]?.pieces ?? 0,
    page,
    pageSize,
  };
}

/** Low-stock count at a location (Store Room counts never-received products as 0). */
export async function lowStockCountAt(ctx: Ctx | null, locationId: string, includeUnstocked: boolean) {
  return (await stockAtLocation(ctx, locationId, { low: true, includeUnstocked, pageSize: 1 })).total;
}
