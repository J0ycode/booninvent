import "server-only";
import { z } from "zod";
import { Types } from "mongoose";
import { Bill, Supplier, Receipt, type BillDoc } from "../models/business";
import { Tenant, User } from "../models/core";
import { guard, guardPlatform, tf } from "./guard";
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
const view = (b: BillDoc): BillView => ({
  id: String(b._id),
  kind: b.kind,
  tenantId: String(b.tenantId),
  supplierId: b.supplierId ? String(b.supplierId) : null,
  receiptId: b.receiptId ? String(b.receiptId) : null,
  billNumber: b.billNumber,
  description: b.description,
  billDate: b.billDate.toISOString(),
  dueDate: b.dueDate.toISOString(),
  amount: b.amount,
  note: b.note,
  status: b.status,
  overdue: isOverdue(b),
  paidDate: b.paidDate?.toISOString() ?? null,
  paidNote: b.paidNote,
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

function statusFilter(status: BillStatusFilter | undefined): Record<string, unknown> {
  if (status === "unpaid") return { status: "UNPAID" };
  if (status === "paid") return { status: "PAID" };
  if (status === "overdue") return { status: "UNPAID", dueDate: { $lt: startOfTodayIST() } };
  return {};
}

function dateFilter(q: BillQuery): Record<string, unknown> {
  const from = q.from ? parseDayIST(q.from) : null;
  const to = q.to ? endOfDayIST(q.to) : null;
  if (!from && !to) return {};
  return { billDate: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
}

export interface BillTotals {
  unpaidCount: number;
  unpaidAmount: number;
  overdueCount: number;
  overdueAmount: number;
}

/** Unpaid and overdue totals for a base filter (ignores the status filter, respects other filters). */
async function totals(base: Record<string, unknown>): Promise<BillTotals> {
  const today = startOfTodayIST();
  const match: Record<string, unknown> = { ...base, status: "UNPAID" };
  for (const k of ["tenantId", "supplierId"]) if (typeof match[k] === "string") match[k] = new Types.ObjectId(match[k] as string);
  const [r] = await Bill.aggregate<BillTotals>([
    { $match: match },
    {
      $group: {
        _id: null,
        unpaidCount: { $sum: 1 },
        unpaidAmount: { $sum: "$amount" },
        overdueCount: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, 1, 0] } },
        overdueAmount: { $sum: { $cond: [{ $lt: ["$dueDate", today] }, "$amount", 0] } },
      },
    },
  ]);
  return r ? { unpaidCount: r.unpaidCount, unpaidAmount: r.unpaidAmount, overdueCount: r.overdueCount, overdueAmount: r.overdueAmount } : { unpaidCount: 0, unpaidAmount: 0, overdueCount: 0, overdueAmount: 0 };
}

async function runList(base: Record<string, unknown>, q: BillQuery) {
  const filter = { ...base, ...statusFilter(q.status), ...dateFilter(q) };
  const pageSize = Math.min(q.pageSize ?? 25, 10000);
  const page = Math.max(q.page ?? 1, 1);
  const [rows, total, t] = await Promise.all([
    Bill.find(filter).sort({ dueDate: 1, _id: 1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    Bill.countDocuments(filter),
    totals({ ...base, ...dateFilter(q) }),
  ]);
  return { rows: rows.map(view), total, page, pageSize, totals: t };
}

/* ---------- supplier bills (inside a shop) ---------- */

export async function listSupplierBills(ctx: Ctx | null, q: BillQuery = {}) {
  const c = await guard(ctx, MANAGERS);
  const base: Record<string, unknown> = { tenantId: c.tenantId, kind: "SUPPLIER" };
  if (q.supplierId && objectId.safeParse(q.supplierId).success) base.supplierId = q.supplierId;
  return runList(base, q);
}

export async function getSupplierBill(ctx: Ctx | null, id: string): Promise<BillView> {
  const c = await guard(ctx, MANAGERS);
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Bill not found.");
  const b = await Bill.findOne({ ...tf(c), kind: "SUPPLIER", _id: id }).lean();
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
  const d = supplierBillSchema.parse(input);
  return runMutation(c, { action: id ? "bill.update" : "bill.create", entity: "bill", idempotencyKey }, async (session) => {
    if (!(await Supplier.exists({ ...tf(c), _id: d.supplierId }).session(session))) throw new AppError("VALIDATION", "Pick one of your suppliers.");
    if (d.receiptId && !(await Receipt.exists({ ...tf(c), _id: d.receiptId }).session(session))) throw new AppError("VALIDATION", "That receipt was not found.");
    const fields = {
      supplierId: d.supplierId,
      billNumber: d.billNumber,
      billDate: parseDayIST(d.billDate)!,
      dueDate: parseDayIST(d.dueDate)!,
      amount: d.amount,
      note: d.note,
      receiptId: d.receiptId || null,
    };
    if (id) {
      const b = await Bill.findOne({ ...tf(c), kind: "SUPPLIER", _id: id }).session(session);
      if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
      if (b.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to edit.");
      b.set(fields);
      await b.save({ session });
      return { result: view(b.toObject()), entityId: id, audit: { billNumber: d.billNumber, amount: d.amount } };
    }
    const [b] = await Bill.create([{ ...tf(c), kind: "SUPPLIER", ...fields, createdBy: c.userId }], { session });
    return { result: view(b.toObject()), entityId: String(b._id), audit: { billNumber: d.billNumber, amount: d.amount } };
  });
}

export async function deleteSupplierBill(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  return runMutation(c, { action: "bill.delete", entity: "bill", idempotencyKey }, async (session) => {
    const b = await Bill.findOne({ ...tf(c), kind: "SUPPLIER", _id: id }).session(session).lean();
    if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
    if (b.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to delete.");
    await Bill.deleteOne({ _id: b._id }, { session });
    return { result: null, entityId: id, audit: { billNumber: b.billNumber, amount: b.amount } };
  });
}

export const markPaidSchema = z.object({
  paidDate: day.optional(), // default today
  note: optionalText(200),
});

async function setPaid(filter: Record<string, unknown>, ctx: Ctx, paid: boolean, input: unknown, idempotencyKey?: string): Promise<BillView> {
  const d = paid ? markPaidSchema.parse(input ?? {}) : { paidDate: undefined, note: undefined };
  return runMutation(ctx, { action: paid ? "bill.mark_paid" : "bill.mark_unpaid", entity: "bill", idempotencyKey }, async (session) => {
    const b = await Bill.findOne(filter).session(session);
    if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
    if (paid && b.status === "PAID") throw new AppError("INVALID_STATE", "This bill is already paid.");
    if (!paid && b.status === "UNPAID") throw new AppError("INVALID_STATE", "This bill is already unpaid.");
    if (paid) b.set({ status: "PAID", paidDate: d.paidDate ? parseDayIST(d.paidDate) : startOfTodayIST(), paidBy: ctx.userId, paidNote: d.note });
    else b.set({ status: "UNPAID", paidDate: null, paidBy: null, paidNote: undefined });
    await b.save({ session });
    return { result: view(b.toObject()), entityId: String(b._id), audit: { tenantId: String(b.tenantId), billNumber: b.billNumber, note: d.note } };
  });
}

export async function markSupplierBillPaid(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  return setPaid({ ...tf(c), kind: "SUPPLIER", _id: id }, c, true, input, idempotencyKey);
}
export async function markSupplierBillUnpaid(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  return setPaid({ ...tf(c), kind: "SUPPLIER", _id: id }, c, false, null, idempotencyKey);
}

/* ---------- platform bills: shop owner, read-only ---------- */

export async function listMyPlatformBills(ctx: Ctx | null, q: BillQuery = {}) {
  const c = await guard(ctx, ["OWNER"]);
  return runList({ tenantId: c.tenantId, kind: "PLATFORM" }, q);
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
  const filter = q.search ? { name: { $regex: q.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {};
  const tenants = await Tenant.find(filter).sort({ name: 1 }).limit(1000).lean();
  const ids = tenants.map((t) => t._id);
  const [owners, unpaid] = await Promise.all([
    User.find({ tenantId: { $in: ids }, role: "OWNER" }, { tenantId: 1, email: 1, createdAt: 1 }).sort({ createdAt: 1 }).lean(),
    Bill.aggregate<{ _id: Types.ObjectId; n: number; amount: number; overdue: number }>([
      { $match: { kind: "PLATFORM", status: "UNPAID", tenantId: { $in: ids } } },
      { $group: { _id: "$tenantId", n: { $sum: 1 }, amount: { $sum: "$amount" }, overdue: { $sum: { $cond: [{ $lt: ["$dueDate", startOfTodayIST()] }, 1, 0] } } } },
    ]),
  ]);
  const ownerBy = new Map<string, string>();
  for (const o of owners) if (!ownerBy.has(String(o.tenantId))) ownerBy.set(String(o.tenantId), o.email);
  const billsBy = new Map(unpaid.map((u) => [String(u._id), u]));
  return tenants.map((t) => ({
    id: String(t._id),
    name: t.name,
    slug: t.slug,
    status: t.status,
    ownerEmail: ownerBy.get(String(t._id)) ?? null,
    unpaidCount: billsBy.get(String(t._id))?.n ?? 0,
    unpaidAmount: billsBy.get(String(t._id))?.amount ?? 0,
    overdueCount: billsBy.get(String(t._id))?.overdue ?? 0,
    createdAt: t.createdAt.toISOString(),
  }));
}

export async function adminGetShop(ctx: Ctx | null, tenantId: string) {
  await guardPlatform(ctx);
  if (!objectId.safeParse(tenantId).success) throw new AppError("NOT_FOUND", "Shop not found.");
  const t = await Tenant.findById(tenantId).lean();
  if (!t) throw new AppError("NOT_FOUND", "Shop not found.");
  const owner = await User.findOne({ tenantId, role: "OWNER" }).sort({ createdAt: 1 }).lean();
  return { id: String(t._id), name: t.name, slug: t.slug, status: t.status, ownerEmail: owner?.email ?? null, ownerName: owner?.name ?? null, createdAt: t.createdAt.toISOString() };
}

export async function adminSetShopStatus(ctx: Ctx | null, tenantId: string, status: unknown, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  const s = z.enum(["ACTIVE", "SUSPENDED"]).parse(status);
  return runMutation(c, { action: s === "SUSPENDED" ? "tenant.suspend" : "tenant.activate", entity: "tenant", idempotencyKey }, async (session) => {
    const t = await Tenant.findByIdAndUpdate(tenantId, { $set: { status: s } }, { session, returnDocument: "after" }).lean();
    if (!t) throw new AppError("NOT_FOUND", "Shop not found.");
    return { result: { id: String(t._id), status: t.status }, entityId: tenantId, audit: { tenantId, status: s } };
  });
}

export async function adminListPlatformBills(ctx: Ctx | null, q: BillQuery = {}) {
  await guardPlatform(ctx);
  const base: Record<string, unknown> = { kind: "PLATFORM" };
  if (q.tenantId && objectId.safeParse(q.tenantId).success) base.tenantId = q.tenantId;
  return runList(base, q);
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
  const d = platformBillSchema.parse(input);
  return runMutation(c, { action: id ? "platform_bill.update" : "platform_bill.create", entity: "bill", idempotencyKey }, async (session) => {
    if (!(await Tenant.exists({ _id: tenantId }).session(session))) throw new AppError("NOT_FOUND", "Shop not found.");
    const fields = { billNumber: d.billNumber, description: d.description, amount: d.amount, billDate: parseDayIST(d.issueDate)!, dueDate: parseDayIST(d.dueDate)! };
    if (id) {
      const b = await Bill.findOne({ kind: "PLATFORM", tenantId, _id: id }).session(session);
      if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
      if (b.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to edit.");
      b.set(fields);
      await b.save({ session });
      return { result: view(b.toObject()), entityId: id, audit: { tenantId, ...d } };
    }
    const [b] = await Bill.create([{ kind: "PLATFORM", tenantId, ...fields, createdBy: c.userId }], { session });
    return { result: view(b.toObject()), entityId: String(b._id), audit: { tenantId, ...d } };
  });
}

export async function adminDeletePlatformBill(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  return runMutation(c, { action: "platform_bill.delete", entity: "bill", idempotencyKey }, async (session) => {
    const b = await Bill.findOne({ kind: "PLATFORM", _id: id }).session(session).lean();
    if (!b) throw new AppError("NOT_FOUND", "Bill not found.");
    if (b.status === "PAID") throw new AppError("INVALID_STATE", "Paid bills are locked. Mark it unpaid first to delete.");
    await Bill.deleteOne({ _id: b._id }, { session });
    return { result: null, entityId: id, audit: { tenantId: String(b.tenantId), billNumber: b.billNumber } };
  });
}

export async function adminMarkPlatformBillPaid(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  return setPaid({ kind: "PLATFORM", _id: id }, c, true, input, idempotencyKey);
}
export async function adminMarkPlatformBillUnpaid(ctx: Ctx | null, id: string, idempotencyKey?: string) {
  const c = await guardPlatform(ctx);
  return setPaid({ kind: "PLATFORM", _id: id }, c, false, null, idempotencyKey);
}
