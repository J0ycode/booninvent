import "server-only";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { stockLevels, stockMovements } from "../db/stock-schema";
import { products } from "../db/schema";
import { productSearch } from "../db/helpers";
import type { MovementType } from "../db/types";
import { guard, assertLocationAccess, isId, assertId } from "../data/guard";
import type { Ctx, TenantCtx } from "../context";

/* Read-only stock queries. They live here because only src/server/stock may import the stock tables. */

const ALL_ROLES = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;

/** Locations this user may see stock for (STORE_STAFF: own store only). null = every location of the shop. */
function visibleLocations(ctx: TenantCtx, locationIds?: string[]): string[] | null {
  if (ctx.role === "STORE_STAFF") {
    const ids = locationIds?.length ? locationIds : ctx.locationIds;
    ids.forEach((id) => assertLocationAccess(ctx, id));
    return ids;
  }
  return locationIds?.length ? locationIds.filter(isId) : null;
}

/** Map productId -> locationId -> quantity. */
export async function getLevels(ctx: Ctx | null, productIds: string[], locationIds?: string[]) {
  const c = await guard(ctx, ALL_ROLES);
  const locs = visibleLocations(c, locationIds);
  const ids = productIds.filter(isId);
  const out: Record<string, Record<string, number>> = {};
  if (!ids.length || (locs && !locs.length)) return out;
  const db = await getDb();
  const rows = await db
    .select({ productId: stockLevels.productId, locationId: stockLevels.locationId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(and(eq(stockLevels.tenantId, c.tenantId), inArray(stockLevels.productId, ids), locs ? inArray(stockLevels.locationId, locs) : undefined));
  for (const r of rows) (out[r.productId] ??= {})[r.locationId] = r.quantity;
  return out;
}

/** Totals for dashboards: pieces at a location, and products with quantity > 0. */
export async function locationTotals(ctx: Ctx | null, locationId: string) {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  assertId(locationId, "Location not found.");
  const db = await getDb();
  const [r] = await db
    .select({
      pieces: sql<number>`coalesce(sum(${stockLevels.quantity}), 0)::int`,
      skus: sql<number>`(count(*) filter (where ${stockLevels.quantity} > 0))::int`,
    })
    .from(stockLevels)
    .where(and(eq(stockLevels.tenantId, c.tenantId), eq(stockLevels.locationId, locationId)));
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
  const pageSize = Math.min(opts.pageSize ?? 25, 5000);
  const page = Math.max(1, opts.page ?? 1);
  // A filter that cannot match anything (unknown id) gives an empty page instead of a database error.
  if ((locs && !locs.length) || (opts.productId && !isId(opts.productId))) return { total: 0, page, pageSize, rows: [] as MovementView[] };
  const where = and(
    eq(stockMovements.tenantId, c.tenantId),
    locs ? inArray(stockMovements.locationId, locs) : undefined,
    opts.productId ? eq(stockMovements.productId, opts.productId) : undefined,
    opts.types?.length ? inArray(stockMovements.type, opts.types) : undefined,
    opts.from ? gte(stockMovements.createdAt, opts.from) : undefined,
    opts.to ? lte(stockMovements.createdAt, opts.to) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select()
    .from(stockMovements)
    .where(where)
    .orderBy(desc(stockMovements.createdAt), desc(stockMovements.seq))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(stockMovements).where(where);
  return {
    total,
    page,
    pageSize,
    rows: rows.map(
      (m): MovementView => ({
        id: m.id,
        productId: m.productId,
        locationId: m.locationId,
        type: m.type,
        quantityDelta: m.quantityDelta,
        balanceAfter: m.balanceAfter,
        refType: m.refType,
        refId: m.refId,
        userId: m.userId,
        note: m.note ?? undefined,
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
  assertId(locationId, "Location not found.");
  const ids = opts.productIds?.filter(isId);
  if (ids && !ids.length) return [];
  const db = await getDb();
  return db
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, c.tenantId),
        eq(stockLevels.locationId, locationId),
        ids ? inArray(stockLevels.productId, ids) : undefined,
        opts.maxQty !== undefined ? lte(stockLevels.quantity, opts.maxQty) : undefined,
      ),
    );
}

/**
 * Store products at or below their reorder level (only products the store has carried: a stock row exists).
 * Joins products, so it lives with the other stock reads.
 */
export async function lowStockAt(ctx: Ctx | null, locationId: string): Promise<{ productId: string; quantity: number; reorderLevel: number }[]> {
  const c = await guard(ctx, ALL_ROLES);
  assertLocationAccess(c, locationId);
  assertId(locationId, "Location not found.");
  const db = await getDb();
  return db
    .select({ productId: stockLevels.productId, quantity: stockLevels.quantity, reorderLevel: products.reorderLevel })
    .from(stockLevels)
    .innerJoin(products, and(eq(products.id, stockLevels.productId), eq(products.tenantId, stockLevels.tenantId)))
    .where(
      and(
        eq(stockLevels.tenantId, c.tenantId),
        eq(stockLevels.locationId, locationId),
        eq(products.active, true),
        gt(products.reorderLevel, 0),
        lte(stockLevels.quantity, products.reorderLevel),
      ),
    );
}

/** Count of low-stock products per location, for dashboards. */
export async function lowStockCount(ctx: Ctx | null, locationId: string) {
  return (await lowStockAt(ctx, locationId)).length;
}

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
  assertId(locationId, "Location not found.");
  const pageSize = Math.min(opts.pageSize ?? 25, 10000);
  const page = Math.max(opts.page ?? 1, 1);
  const quantity = sql<number>`coalesce(${stockLevels.quantity}, 0)`;
  const onLevel = and(eq(stockLevels.productId, products.id), eq(stockLevels.locationId, locationId), eq(stockLevels.tenantId, c.tenantId));
  const where = and(
    eq(products.tenantId, c.tenantId),
    eq(products.active, true),
    productSearch(opts.q),
    opts.includeUnstocked ? undefined : isNotNull(stockLevels.productId), // carried: a stock row exists
    opts.low ? and(gt(products.reorderLevel, 0), sql`${quantity} <= ${products.reorderLevel}`) : undefined,
  );
  const db = await getDb();
  const rows = await db
    .select({
      productId: products.id,
      name: products.name,
      sku: products.sku,
      barcode: products.barcode,
      category: products.category,
      sellingPrice: products.sellingPrice,
      reorderLevel: products.reorderLevel,
      quantity: sql<number>`${quantity}::int`,
    })
    .from(products)
    .leftJoin(stockLevels, onLevel)
    .where(where)
    .orderBy(asc(products.nameLower), asc(products.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [sum] = await db
    .select({ total: count(), pieces: sql<number>`coalesce(sum(${quantity}), 0)::int` })
    .from(products)
    .leftJoin(stockLevels, onLevel)
    .where(where);
  return { rows: rows as StockRow[], total: sum?.total ?? 0, pieces: sum?.pieces ?? 0, page, pageSize };
}

/** Low-stock count at a location (Store Room counts never-received products as 0). */
export async function lowStockCountAt(ctx: Ctx | null, locationId: string, includeUnstocked: boolean) {
  return (await stockAtLocation(ctx, locationId, { low: true, includeUnstocked, pageSize: 1 })).total;
}
