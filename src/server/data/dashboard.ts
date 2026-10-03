import "server-only";
import { and, count, eq, isNull, lt, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "../db";
import { products, suppliers, receipts, restockRequests, returnDamageEntries, dispatches, bills, users, apiKeys } from "../db/schema";
import { guard, guardPlatform, staffLocationId } from "./guard";
import { listLocations, getStoreRoom } from "./locations";
import { listSupplierBills, listMyPlatformBills, adminListPlatformBills, type BillTotals } from "./bills";
import { getProductsByIds } from "./products";
import { listMovements, locationTotals, lowStockCountAt, type MovementView } from "../stock/read";
import { startOfTodayIST } from "@/lib/dates";
import type { Ctx, TenantCtx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

/** Number of rows in a table that match. */
async function rowCount(table: PgTable, where: SQL | undefined): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(table).where(where);
  return r?.n ?? 0;
}

export interface ActivityRow extends MovementView {
  productName: string;
  locationName: string;
}

async function recentActivity(c: TenantCtx, locationId?: string, limit = 8): Promise<ActivityRow[]> {
  const [mv, locations] = await Promise.all([listMovements(c, { locationId, pageSize: limit }), listLocations(c)]);
  const byId = await getProductsByIds(
    c,
    mv.rows.map((m) => m.productId),
  );
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  return mv.rows.map((m) => ({ ...m, productName: byId.get(m.productId)?.name ?? "Product", locationName: locName.get(m.locationId) ?? "" }));
}

/** Pending work for the Store Room / owner: forwarded requests, store returns, delivery discrepancies. */
async function pendingCounts(c: TenantCtx) {
  const [requests, returns, discrepancies] = await Promise.all([
    rowCount(restockRequests, and(eq(restockRequests.tenantId, c.tenantId), eq(restockRequests.status, "SENT"))),
    rowCount(returnDamageEntries, and(eq(returnDamageEntries.tenantId, c.tenantId), eq(returnDamageEntries.status, "PENDING"))),
    rowCount(dispatches, and(eq(dispatches.tenantId, c.tenantId), eq(dispatches.status, "RECEIVED_WITH_ISSUES"))),
  ]);
  return { requests, returns, discrepancies };
}

export async function storeroomDashboard(ctx: Ctx | null) {
  const c = await guard(ctx, MANAGERS);
  const srId = (await getStoreRoom(c)).id;
  const [productCount, totals, low, pending, supplierBills, activity] = await Promise.all([
    rowCount(products, and(eq(products.tenantId, c.tenantId), eq(products.active, true))),
    locationTotals(c, srId),
    lowStockCountAt(c, srId, true),
    pendingCounts(c),
    listSupplierBills(c, { pageSize: 1 }),
    recentActivity(c),
  ]);
  return { storeRoomId: srId, products: productCount, pieces: totals.pieces, low, pending, bills: supplierBills.totals, activity };
}

export async function storeDashboard(ctx: Ctx | null) {
  const c = await guard(ctx, ["STORE_STAFF"]);
  const loc = staffLocationId(c);
  const [totals, low, incoming, entries, waiting, activity] = await Promise.all([
    locationTotals(c, loc),
    lowStockCountAt(c, loc, false),
    rowCount(dispatches, and(eq(dispatches.tenantId, c.tenantId), eq(dispatches.toLocationId, loc), eq(dispatches.status, "DISPATCHED"))),
    rowCount(returnDamageEntries, and(eq(returnDamageEntries.tenantId, c.tenantId), eq(returnDamageEntries.locationId, loc), eq(returnDamageEntries.status, "PENDING"))),
    rowCount(restockRequests, and(eq(restockRequests.tenantId, c.tenantId), eq(restockRequests.locationId, loc), eq(restockRequests.status, "WAITING_STAFF_APPROVAL"))),
    recentActivity(c, loc),
  ]);
  return { locationId: loc, pieces: totals.pieces, products: totals.skus, low, incoming, entries, waiting, activity };
}

export async function ownerDashboard(ctx: Ctx | null) {
  const c = await guard(ctx, ["OWNER"]);
  const locations = await listLocations(c);
  const perLocation = await Promise.all(
    locations.map(async (l) => {
      const [t, low] = await Promise.all([locationTotals(c, l.id), lowStockCountAt(c, l.id, l.type === "STORE_ROOM")]);
      return { id: l.id, name: l.name, type: l.type, pieces: t.pieces, low };
    }),
  );
  const [pending, supplier, platform, activity] = await Promise.all([pendingCounts(c), listSupplierBills(c, { pageSize: 1 }), listMyPlatformBills(c, { pageSize: 1 }), recentActivity(c)]);
  return { locations: perLocation, pending, supplierBills: supplier.totals, platformBills: platform.totals, activity };
}

export async function adminDashboard(ctx: Ctx | null): Promise<BillTotals> {
  return (await adminListPlatformBills(ctx, { pageSize: 1 })).totals;
}

export interface ChecklistItem {
  label: string;
  done: boolean;
  href: string;
}

/** Short first-run checklist for a new shop (owner). Hidden once everything is done. */
export async function setupChecklist(ctx: Ctx | null): Promise<ChecklistItem[]> {
  const c = await guard(ctx, ["OWNER"]);
  const [supplierCount, productCount, receiptCount, userCount, keyCount] = await Promise.all([
    rowCount(suppliers, eq(suppliers.tenantId, c.tenantId)),
    rowCount(products, eq(products.tenantId, c.tenantId)),
    rowCount(receipts, eq(receipts.tenantId, c.tenantId)),
    rowCount(users, eq(users.tenantId, c.tenantId)),
    rowCount(apiKeys, and(eq(apiKeys.tenantId, c.tenantId), isNull(apiKeys.revokedAt))),
  ]);
  return [
    { label: "Invite your Store Room manager and store staff", done: userCount > 1, href: "/owner/users" },
    { label: "Store Room: add your suppliers", done: supplierCount > 0, href: "/owner/users" },
    { label: "Store Room: add or import your products", done: productCount > 0, href: "/owner/users" },
    { label: "Store Room: receive the first delivery", done: receiptCount > 0, href: "/owner/users" },
    { label: "Create the sales API key for your billing system", done: keyCount > 0, href: "/owner/settings" },
  ];
}

/* ---------- notification bell (computed on load, no realtime) ---------- */

export interface Notice {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "peach" | "danger" | "powder" | "lavender";
}

export async function notifications(ctx: Ctx | null): Promise<Notice[]> {
  if (!ctx) return [];
  const out: Notice[] = [];
  if (ctx.role === "PLATFORM_ADMIN") {
    await guardPlatform(ctx);
    const overdue = await rowCount(bills, and(eq(bills.kind, "PLATFORM"), eq(bills.status, "UNPAID"), lt(bills.dueDate, startOfTodayIST())));
    if (overdue) out.push({ key: "overdue", label: "Overdue platform bills", count: overdue, href: "/admin", tone: "danger" });
    return out;
  }
  if (ctx.role === "STORE_STAFF") {
    const d = await storeDashboard(ctx);
    if (d.incoming) out.push({ key: "incoming", label: "Dispatches to confirm", count: d.incoming, href: "/store/incoming", tone: "powder" });
    if (d.waiting) out.push({ key: "waiting", label: "Suggestion waiting for your review", count: d.waiting, href: "/store/restock", tone: "lavender" });
    if (d.low) out.push({ key: "low", label: "Low-stock items", count: d.low, href: "/store/stock?low=1", tone: "peach" });
    return out;
  }
  const c = await guard(ctx, MANAGERS);
  const base = c.role === "OWNER" ? "/owner" : "/storeroom";
  const sr = await getStoreRoom(c);
  const [pending, low, supplierBills] = await Promise.all([pendingCounts(c), lowStockCountAt(c, sr.id, true), listSupplierBills(c, { pageSize: 1 })]);
  if (pending.requests) out.push({ key: "req", label: "Restock requests to approve", count: pending.requests, href: c.role === "OWNER" ? "/owner" : "/storeroom/requests", tone: "lavender" });
  if (pending.returns) out.push({ key: "ret", label: "Returns and write-offs to approve", count: pending.returns, href: c.role === "OWNER" ? "/owner/approvals" : "/storeroom/returns", tone: "lavender" });
  if (pending.discrepancies) out.push({ key: "dis", label: "Delivery discrepancies", count: pending.discrepancies, href: c.role === "OWNER" ? "/owner/approvals" : "/storeroom/returns", tone: "peach" });
  if (low) out.push({ key: "low", label: "Low-stock items in the Store Room", count: low, href: `${base}/reports?type=low`, tone: "peach" });
  if (supplierBills.totals.overdueCount) out.push({ key: "bills", label: "Overdue supplier bills", count: supplierBills.totals.overdueCount, href: `${base}/bills?status=overdue`, tone: "danger" });
  if (c.role === "OWNER") {
    const p = await listMyPlatformBills(c, { pageSize: 1 });
    if (p.totals.overdueCount) out.push({ key: "pbills", label: "Overdue BoonBaby bills", count: p.totals.overdueCount, href: "/owner/billing?status=overdue", tone: "danger" });
  }
  return out;
}
