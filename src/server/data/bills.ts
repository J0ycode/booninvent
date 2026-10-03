import "server-only";
import { z } from "zod";
import { and, asc, count, eq, gte, ilike, inArray, lt, lte, sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import { bills, suppliers, receipts, tenants, users } from "../db/schema";
import { escapeLike } from "../db/helpers";
import { guard, guardPlatform, tf, assertId, isId } from "./guard";
import { runMutation } from "../mutation";
import { AppError } from "../errors";
import { objectId, rupeesToPaise, optionalText } from "@/lib/validation";
import { parseDayIST, endOfDayIST, startOfTodayIST, isOverdue } from "@/lib/dates";
import type { Ctx } from "../context";

/*
 * Manual bills. No money moves through the app.
 *  SUPPLIER bills: inside a shop, OWNER + STOREROOM_MANAGER only (never STORE_STAFF).
 *  PLATFORM bills: created/marked by PLATFORM_ADMIN only; the shop's OWNER sees them read-only.
 * "Overdue" is computed (UNPAID and past due), never stored.
 */

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

export type BillStatusFilter = "all" | "unpaid" | "overdue" | "paid";

export interface BillView {
  id: string;
  kind: "SUPPLIER" | "PLATFORM";
  tenantId: string;
  supplierId: string | null;
  receiptId: string | null;
  billNumber: string;
  description?: string;
  billDate: string;
  dueDate: string;
  amount: number;
  note?: string;
  status: "UNPAID" | "PAID";
  overdue: boolean;
  paidDate: string | null;
  paidNote?: string;
  createdAt: string;
}
type BillRow = typeof bills.$inferSelect;
const view = (b: BillRow): BillView => ({
  id: b.id,
  kind: b.kind,
  tenantId: b.tenantId,
  supplierId: b.supplierId,
  receiptId: b.receiptId,
  billNumber: b.billNumber,
  description: b.description ?? undefined,
  billDate: b.billDate.toISOString(),
  dueDate: b.dueDate.toISOString(),
  amount: b.amount,
  note: b.note ?? undefined,
  status: b.status,
  overdue: isOverdue(b),
  paidDate: b.paidDate?.toISOString() ?? null,
  paidNote: b.paidNote ?? undefined,
  createdAt: b.createdAt.toISOString(),
});

export interface BillQuery {
  status?: BillStatusFilter;
  from?: string; // yyyy-mm-dd (bill date)
  to?: string;
  supplierId?: string;
  tenantId?: string;
  page?: number;
  pageSize?: number;
}

function statusFilter(status: BillStatusFilter | undefined): SQL | undefined {
  if (status === "unpaid") return eq(bills.status, "UNPAID");
  if (status === "paid") return eq(bills.status, "PAID");
  if (status === "overdue") return and(eq(bills.status, "UNPAID"), lt(bills.dueDate, startOfTodayIST()));
  return undefined;
}

function dateFilter(q: BillQuery): SQL | undefined {
  const from = q.from ? parseDayIST(q.from) : null;
  const to = q.to ? endOfDayIST(q.to) : null;
  return and(from ? gte(bills.billDate, from) : undefined, to ? lte(bills.billDate, to) : undefined);
}

export interface BillTotals {
  unpaidCount: number;
  unpaidAmount: number;
  overdueCount: number;
  overdueAmount: number;
}

/** Unpaid and overdue totals for a base filter (ignores the status filter, respects other filters). */
async function totals(base: SQL | undefined): Promise<BillTotals> {
  const overdue = lt(bills.dueDate, startOfTodayIST());
  const db = await getDb();
  const [r] = await db
    .select({
      unpaidCount: count(),
      unpaidAmount: sql`coalesce(sum(${bills.amount}), 0)`.mapWith(Number),
      overdueCount: sql`count(*) filter (where ${overdue})`.mapWith(Number),
      overdueAmount: sql`coalesce(sum(${bills.amount}) filter (where ${overdue}), 0)`.mapWith(Number),
    })
    .from(bills)
    .where(and(base, eq(bills.status, "UNPAID")));
  return r ?? { unpaidCount: 0, unpaidAmount: 0, overdueCount: 0, overdueAmount: 0 };
}

async function runList(base: SQL | undefined, q: BillQuery) {
  const where = and(base, statusFilter(q.status), dateFilter(q));
  const pageSize = Math.min(q.pageSize ?? 25, 10000);
  const page = Math.max(q.page ?? 1, 1);
  const db = await getDb();
  const rows = await db
    .select()
    .from(bills)
    .where(where)
    .orderBy(asc(bills.dueDate), asc(bills.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(bills).where(where);
  return { rows: rows.map(view), total, page, pageSize, totals: await totals(and(base, dateFilter(q))) };
}

const supplierBillsOf = (tenantId: string) => and(eq(bills.tenantId, tenantId), eq(bills.kind, "SUPPLIER"));
const PLATFORM = eq(bills.kind, "PLATFORM");

/* ---------- supplier bills (inside a shop) ---------- */

export async function listSupplierBills(ctx: Ctx | null, q: BillQuery = {}) {
  const c = await guard(ctx, MANAGERS);
  return runList(and(supplierBillsOf(c.tenantId), isId(q.supplierId) ? eq(bills.supplierId, q.supplierId) : undefined), q);
}

export async function getSupplierBill(ctx: Ctx | null, id: string): Promise<BillView> {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Bill not found.");
  const db = await getDb();
  const [b] = await db
    .select()
    .from(bills)
    .where(and(supplierBillsOf(c.tenantId), eq(bills.id, id)));
  if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
  return view(b);
}

const day = z.string().refine((v) => !!parseDayIST(v), "Pick a date");

export const supplierBillSchema = z
  .object({
    supplierId: objectId,
    billNumber: z.string().trim().min(1, "Enter the bill number").max(60),
    billDate: day,
    dueDate: day,
    amount: rupeesToPaise.refine((n) => n > 0, "Enter the amount"),
    note: optionalText(500),
    receiptId: objectId.optional().or(z.literal("")),
  })
  .refine((v) => parseDayIST(v.dueDate)! >= parseDayIST(v.billDate)!, { message: "Due date cannot be before the bill date", path: ["dueDate"] });

export async function saveSupplierBill(ctx: Ctx | null, id: string | null, input: unknown, idempotencyKey?: string): Promise<BillView> {
  const c = await guard(ctx, MANAGERS);
  if (id) assertId(id, "Bill not found.");
  const d = supplierBillSchema.parse(input);
  return runMutation(c, { action: id ? "bill.update" : "bill.create", entity: "bill", idempotencyKey }, async (tx) => {
    const [sup] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, c.tenantId), eq(suppliers.id, d.supplierId)));
    if (!sup) throw new AppError("VALIDATION", "Pick one of your suppliers.");
    if (d.receiptId) {
      const [rc] = await tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(and(eq(receipts.tenantId, c.tenantId), eq(receipts.id, d.receiptId)));
      if (!rc) throw new AppError("VALIDATION", "That receipt was not found.");
    }
    const fields = {
      supplierId: d.supplierId,
      billNumber: d.billNumber,
      billDate: parseDayIST(d.billDate)!,
      dueDate: parseDayIST(d.dueDate)!,
      amount: d.amount,
      note: d.note ?? null,
      receiptId: d.receiptId || null,
    };
    if (id) {
      const mine = and(supplierBillsOf(c.tenantId), eq(bills.id, id));
      const [cur] = await tx.select({ status: bills.status }).from(bills).where(mine).for("update");
      if (!cur) throw new AppError("NOT_FOUND", "Bill not found.");
      if (cur.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to edit.");
      const [b] = await tx.update(bills).set(fields).where(mine).returning();
      return { result: view(b), entityId: id, audit: { billNumber: d.billNumber, amount: d.amount } };
    }
    const [b] = await tx
      .insert(bills)
      .values({ ...tf(c), kind: "SUPPLIER", ...fields, createdBy: c.userId })
      .returning();
    return { result: view(b), entityId: b.id, audit: { billNumber: d.billNumber, amount: d.amount } };
  });
}

/** Deletes one unpaid bill matched by `where` (shared by supplier and platform bills). */
async function deleteUnpaid(ctx: Ctx, action: string, where: SQL | undefined, id: string, idempotencyKey?: string) {
  return runMutation(ctx, { action, entity: "bill", idempotencyKey }, async (tx) => {
    const [b] = await tx.select().from(bills).where(where).for("update");
    if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
    if (b.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to delete.");
    await tx.delete(bills).where(eq(bills.id, b.id));
    return { result: null, entityId: id, audit: { tenantId: b.tenantId, billNumber: b.billNumber, amount: b.amount } };
  });
}

export async function deleteSupplierBill(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Bill not found.");
  return deleteUnpaid(c, "bill.delete", and(supplierBillsOf(c.tenantId), eq(bills.id, id)), id, idempotencyKey);
}

export const markPaidSchema = z.object({
  paidDate: day.optional(), // default today
  note: optionalText(200),
});

async function setPaid(where: SQL | undefined, ctx: Ctx, paid: boolean, input: unknown, idempotencyKey?: string): Promise<BillView> {
  const d = paid ? markPaidSchema.parse(input ?? {}) : { paidDate: undefined, note: undefined };
  return runMutation(ctx, { action: paid ? "bill.mark_paid" : "bill.mark_unpaid", entity: "bill", idempotencyKey }, async (tx) => {
    const [cur] = await tx.select().from(bills).where(where).for("update");
    if (!cur) throw new AppError("NOT_FOUND", "Bill not found.");
    if (paid && cur.status === "PAID") throw new AppError("INVALID_STATE", "This bill is already paid.");
    if (!paid && cur.status === "UNPAID") throw new AppError("INVALID_STATE", "This bill is already unpaid.");
    const [b] = await tx
      .update(bills)
      .set(
        paid
          ? { status: "PAID", paidDate: d.paidDate ? parseDayIST(d.paidDate) : startOfTodayIST(), paidBy: ctx.userId, paidNote: d.note ?? null }
          : { status: "UNPAID", paidDate: null, paidBy: null, paidNote: null },
      )
      .where(eq(bills.id, cur.id))
      .returning();
    return { result: view(b), entityId: b.id, audit: { tenantId: b.tenantId, billNumber: b.billNumber, note: d.note } };
  });
}

export async function markSupplierBillPaid(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Bill not found.");
  return setPaid(and(supplierBillsOf(c.tenantId), eq(bills.id, id)), c, true, input, idempotencyKey);
}
export async function markSupplierBillUnpaid(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Bill not found.");
  return setPaid(and(supplierBillsOf(c.tenantId), eq(bills.id, id)), c, false, null, idempotencyKey);
}

/* ---------- platform bills: shop owner, read-only ---------- */

export async function listMyPlatformBills(ctx: Ctx | null, q: BillQuery = {}) {
  const c = await guard(ctx, ["OWNER"]);
  return runList(and(eq(bills.tenantId, c.tenantId), PLATFORM), q);
}

/* ---------- platform admin ---------- */

export interface ShopRow {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  ownerEmail: string | null;
  unpaidCount: number;
  unpaidAmount: number;
  overdueCount: number;
  createdAt: string;
}

export async function adminListShops(ctx: Ctx | null, q: { search?: string } = {}): Promise<ShopRow[]> {
  await guardPlatform(ctx);
  const db = await getDb();
  const search = q.search?.trim();
  const shops = await db
    .select()
    .from(tenants)
    .where(search ? ilike(tenants.name, `%${escapeLike(search)}%`) : undefined)
    .orderBy(asc(tenants.name))
    .limit(1000);
  if (!shops.length) return [];
  const ids = shops.map((t) => t.id);
  const owners = await db
    .select({ tenantId: users.tenantId, email: users.email })
    .from(users)
    .where(and(inArray(users.tenantId, ids), eq(users.role, "OWNER")))
    .orderBy(asc(users.createdAt));
  const unpaid = await db
    .select({
      tenantId: bills.tenantId,
      n: count(),
      amount: sql`coalesce(sum(${bills.amount}), 0)`.mapWith(Number),
      overdue: sql`count(*) filter (where ${lt(bills.dueDate, startOfTodayIST())})`.mapWith(Number),
    })
    .from(bills)
    .where(and(PLATFORM, eq(bills.status, "UNPAID"), inArray(bills.tenantId, ids)))
    .groupBy(bills.tenantId);
  const ownerBy = new Map<string, string>();
  for (const o of owners) if (o.tenantId && !ownerBy.has(o.tenantId)) ownerBy.set(o.tenantId, o.email);
  const billsBy = new Map(unpaid.map((u) => [u.tenantId, u]));
  return shops.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    status: t.status,
    ownerEmail: ownerBy.get(t.id) ?? null,
    unpaidCount: billsBy.get(t.id)?.n ?? 0,
    unpaidAmount: billsBy.get(t.id)?.amount ?? 0,
    overdueCount: billsBy.get(t.id)?.overdue ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function adminGetShop(ctx: Ctx | null, tenantId: string) {
  await guardPlatform(ctx);
  assertId(tenantId, "Shop not found.");
  const db = await getDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new AppError("NOT_FOUND", "Shop not found.");
  const [owner] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, "OWNER")))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return { id: t.id, name: t.name, slug: t.slug, status: t.status, ownerEmail: owner?.email ?? null, ownerName: owner?.name ?? null, createdAt: t.createdAt.toISOString() };
}

export async function adminSetShopStatus(ctx: Ctx | null, tenantId: string, status: unknown, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  assertId(tenantId, "Shop not found.");
  const s = z.enum(["ACTIVE", "SUSPENDED"]).parse(status);
  return runMutation(c, { action: s === "SUSPENDED" ? "tenant.suspend" : "tenant.activate", entity: "tenant", idempotencyKey }, async (tx) => {
    const [t] = await tx.update(tenants).set({ status: s }).where(eq(tenants.id, tenantId)).returning({ id: tenants.id, status: tenants.status });
    if (!t) throw new AppError("NOT_FOUND", "Shop not found.");
    return { result: { id: t.id, status: t.status }, entityId: tenantId, audit: { tenantId, status: s } };
  });
}

export async function adminListPlatformBills(ctx: Ctx | null, q: BillQuery = {}) {
  await guardPlatform(ctx);
  return runList(and(PLATFORM, isId(q.tenantId) ? eq(bills.tenantId, q.tenantId) : undefined), q);
}

export const platformBillSchema = z
  .object({
    billNumber: z.string().trim().min(1, "Enter the bill number").max(60),
    description: z.string().trim().min(2, "Enter a description").max(300),
    amount: rupeesToPaise.refine((n) => n > 0, "Enter the amount"),
    issueDate: day,
    dueDate: day,
  })
  .refine((v) => parseDayIST(v.dueDate)! >= parseDayIST(v.issueDate)!, { message: "Due date cannot be before the issue date", path: ["dueDate"] });

export async function adminSavePlatformBill(ctx: Ctx | null, tenantId: string, id: string | null, input: unknown, idempotencyKey?: string): Promise<BillView> {
  const c = await guardPlatform(ctx);
  assertId(tenantId, "Shop not found.");
  if (id) assertId(id, "Bill not found.");
  const d = platformBillSchema.parse(input);
  return runMutation(c, { action: id ? "platform_bill.update" : "platform_bill.create", entity: "bill", idempotencyKey }, async (tx) => {
    const [shop] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId));
    if (!shop) throw new AppError("NOT_FOUND", "Shop not found.");
    const fields = { billNumber: d.billNumber, description: d.description, amount: d.amount, billDate: parseDayIST(d.issueDate)!, dueDate: parseDayIST(d.dueDate)! };
    if (id) {
      const mine = and(PLATFORM, eq(bills.tenantId, tenantId), eq(bills.id, id));
      const [cur] = await tx.select({ status: bills.status }).from(bills).where(mine).for("update");
      if (!cur) throw new AppError("NOT_FOUND", "Bill not found.");
      if (cur.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to edit.");
      const [b] = await tx.update(bills).set(fields).where(mine).returning();
      return { result: view(b), entityId: id, audit: { tenantId, ...d } };
    }
    const [b] = await tx
      .insert(bills)
      .values({ kind: "PLATFORM", tenantId, ...fields, createdBy: c.userId })
      .returning();
    return { result: view(b), entityId: b.id, audit: { tenantId, ...d } };
  });
}

export async function adminDeletePlatformBill(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  assertId(id, "Bill not found.");
  return deleteUnpaid(c, "platform_bill.delete", and(PLATFORM, eq(bills.id, id)), id, idempotencyKey);
}

export async function adminMarkPlatformBillPaid(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  assertId(id, "Bill not found.");
  return setPaid(and(PLATFORM, eq(bills.id, id)), c, true, input, idempotencyKey);
}
export async function adminMarkPlatformBillUnpaid(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  assertId(id, "Bill not found.");
  return setPaid(and(PLATFORM, eq(bills.id, id)), c, false, null, idempotencyKey);
}
