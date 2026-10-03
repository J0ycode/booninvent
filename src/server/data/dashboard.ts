import "server-only";
import { Product, Supplier, Receipt, RestockRequest, ReturnDamageEntry, Dispatch, Bill } from "../models/business";
import { User, ApiKey, Location } from "../models/core";
import { guard, guardPlatform, tf, staffLocationId } from "./guard";
import { listLocations } from "./locations";
import { listSupplierBills, listMyPlatformBills, adminListPlatformBills, type BillTotals } from "./bills";
import { getProductsByIds } from "./products";
import { listMovements, locationTotals, lowStockCountAt, type MovementView } from "../stock/read";
import { startOfTodayIST } from "@/lib/dates";
import type { Ctx, TenantCtx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

export interface ActivityRow extends MovementView {
  productName: string;
  locationName: string;
}

async function recentActivity(c: TenantCtx, locationId?: string, limit = 8): Promise<ActivityRow[]> {
  const [mv, locations] = await Promise.all([listMovements(c, { locationId, pageSize: limit }), listLocations(c)]);
  const products = await getProductsByIds(
    c,
    mv.rows.map((m) => m.productId),
  );
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  return mv.rows.map((m) => ({ ...m, productName: products.get(m.productId)?.name ?? "Product", locationName: locName.get(m.locationId) ?? "" }));
}

/** Pending work for the Store Room / owner: forwarded requests, store returns, delivery discrepancies. */
async function pendingCounts(c: TenantCtx) {
  const [requests, returns, discrepancies] = await Promise.all([
    RestockRequest.countDocuments({ ...tf(c), status: "SENT" }),
    ReturnDamageEntry.countDocuments({ ...tf(c), status: "PENDING" }),
    Dispatch.countDocuments({ ...tf(c), status: "RECEIVED_WITH_ISSUES" }),
  ]);
  return { requests, returns, discrepancies };
}

export async function storeroomDashboard(ctx: Ctx | null) {
  const c = await guard(ctx, MANAGERS);
  const sr = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).lean();
  const srId = String(sr!._id);
  const [products, totals, low, pending, bills, activity] = await Promise.all([
    Product.countDocuments({ ...tf(c), active: true }),
    locationTotals(c, srId),
    lowStockCountAt(c, srId, true),
    pendingCounts(c),
    listSupplierBills(c, { pageSize: 1 }),
    recentActivity(c),
  ]);
  return { storeRoomId: srId, products, pieces: totals.pieces, low, pending, bills: bills.totals, activity };
}

export async function storeDashboard(ctx: Ctx | null) {
  const c = await guard(ctx, ["STORE_STAFF"]);
  const loc = staffLocationId(c);
  const [totals, low, incoming, entries, waiting, activity] = await Promise.all([
    locationTotals(c, loc),
    lowStockCountAt(c, loc, false),
    Dispatch.countDocuments({ ...tf(c), toLocationId: loc, status: "DISPATCHED" }),
    ReturnDamageEntry.countDocuments({ ...tf(c), locationId: loc, status: "PENDING" }),
    RestockRequest.countDocuments({ ...tf(c), locationId: loc, status: "WAITING_STAFF_APPROVAL" }),
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
  const [suppliers, products, receipts, users, key] = await Promise.all([
    Supplier.exists(tf(c)),
    Product.exists(tf(c)),
    Receipt.exists(tf(c)),
    User.countDocuments(tf(c)),
    ApiKey.exists({ ...tf(c), revokedAt: null }),
  ]);
  return [
    { label: "Invite your Store Room manager and store staff", done: users > 1, href: "/owner/users" },
    { label: "Store Room: add your suppliers", done: !!suppliers, href: "/owner/users" },
    { label: "Store Room: add or import your products", done: !!products, href: "/owner/users" },
    { label: "Store Room: receive the first delivery", done: !!receipts, href: "/owner/users" },
    { label: "Create the sales API key for your billing system", done: !!key, href: "/owner/settings" },
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
    const overdue = await Bill.countDocuments({ kind: "PLATFORM", status: "UNPAID", dueDate: { $lt: startOfTodayIST() } });
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
  const sr = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).lean();
  const [pending, low, bills] = await Promise.all([pendingCounts(c), lowStockCountAt(c, String(sr!._id), true), listSupplierBills(c, { pageSize: 1 })]);
  if (pending.requests) out.push({ key: "req", label: "Restock requests to approve", count: pending.requests, href: c.role === "OWNER" ? "/owner" : "/storeroom/requests", tone: "lavender" });
  if (pending.returns) out.push({ key: "ret", label: "Returns and write-offs to approve", count: pending.returns, href: c.role === "OWNER" ? "/owner/approvals" : "/storeroom/returns", tone: "lavender" });
  if (pending.discrepancies) out.push({ key: "dis", label: "Delivery discrepancies", count: pending.discrepancies, href: c.role === "OWNER" ? "/owner/approvals" : "/storeroom/returns", tone: "peach" });
  if (low) out.push({ key: "low", label: "Low-stock items in the Store Room", count: low, href: `${base}/reports?type=low`, tone: "peach" });
  if (bills.totals.overdueCount) out.push({ key: "bills", label: "Overdue supplier bills", count: bills.totals.overdueCount, href: `${base}/bills?status=overdue`, tone: "danger" });
  if (c.role === "OWNER") {
    const p = await listMyPlatformBills(c, { pageSize: 1 });
    if (p.totals.overdueCount) out.push({ key: "pbills", label: "Overdue BoonBaby bills", count: p.totals.overdueCount, href: "/owner/billing?status=overdue", tone: "danger" });
  }
  return out;
}
