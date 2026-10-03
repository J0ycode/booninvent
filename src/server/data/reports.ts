import "server-only";
import { z } from "zod";
import { guard } from "./guard";
import { listLocations } from "./locations";
import { listProducts, getProductsByIds } from "./products";
import { listSupplierBills } from "./bills";
import { listSuppliers } from "./suppliers";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";
import { getLevels, listMovements, stockAtLocation } from "../stock/read";
import { listDispatches } from "../stock/dispatches";
import { listEntries, TYPE_LABEL } from "../stock/returns";
import { parseDayIST, endOfDayIST } from "@/lib/dates";
import { isoDay } from "@/lib/format";
import type { Ctx } from "../context";

/*
 * Reports for OWNER and STOREROOM_MANAGER. Each report is a flat table (shown on screen and exported as CSV).
 * Values are plain strings/numbers; money is in rupees with 2 decimals.
 */

export const REPORT_TYPES = {
  stock: "Stock list",
  low: "Low stock",
  dispatches: "Dispatch history by store",
  returns: "Damaged and returns",
  movements: "Stock movement history",
  bills: "Bills summary",
} as const;
export type ReportType = keyof typeof REPORT_TYPES;

export interface ReportColumn {
  key: string;
  header: string;
  numeric?: boolean;
}
export interface Report {
  type: ReportType;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  truncated: boolean;
}
/** A report after the column choice was applied. allColumns is what the picker offers. */
export interface PickedReport extends Report {
  allColumns: ReportColumn[];
}

export const reportQuerySchema = z.object({
  type: z.enum(Object.keys(REPORT_TYPES) as [ReportType, ...ReportType[]]),
  location: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  /** Comma-separated column keys to keep, in report order. Empty = every column. */
  cols: z.string().max(2000).optional(),
});

/**
 * Builds a report and keeps only the chosen columns (for the preview and the CSV).
 * Unknown keys are ignored; if none of the chosen keys exist, every column is kept.
 */
export async function buildReport(ctx: Ctx | null, input: unknown): Promise<PickedReport> {
  const report = await buildFullReport(ctx, input);
  const wanted = new Set((reportQuerySchema.parse(input).cols ?? "").split(",").filter(Boolean));
  const kept = report.columns.filter((c) => wanted.has(c.key));
  return { ...report, allColumns: report.columns, columns: kept.length ? kept : report.columns };
}

const MAX_ROWS = 5000;
const rupees = (paise: number | null | undefined) => (paise == null ? "" : (paise / 100).toFixed(2));
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "");
const day = (iso: string | null | undefined) => (iso ? isoDay(new Date(iso)) : "");

async function buildFullReport(ctx: Ctx | null, input: unknown): Promise<Report> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER"]);
  const q = reportQuerySchema.parse(input);
  const locations = await listLocations(c);
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const location = q.location && locName.has(q.location) ? q.location : undefined;
  const from = q.from ? (parseDayIST(q.from) ?? undefined) : undefined;
  const to = q.to ? (endOfDayIST(q.to) ?? undefined) : undefined;
  const title = REPORT_TYPES[q.type];

  switch (q.type) {
    case "stock": {
      const shown = location ? locations.filter((l) => l.id === location) : locations;
      const { rows: products, total } = await listProducts(c, { status: "active", pageSize: 100, page: 1 }).then(async (first) => {
        // Page through the catalogue (100 per call) up to MAX_ROWS.
        const all = [...first.rows];
        for (let p = 2; all.length < Math.min(first.total, MAX_ROWS); p++) all.push(...(await listProducts(c, { status: "active", pageSize: 100, page: p })).rows);
        return { rows: all, total: first.total };
      });
      const levels = await getLevels(
        c,
        products.map((p) => p.id),
        shown.map((l) => l.id),
      );
      return {
        type: q.type,
        title,
        truncated: total > products.length,
        columns: [
          { key: "name", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "barcode", header: "Barcode" },
          { key: "category", header: "Category" },
          { key: "price", header: "Selling price", numeric: true },
          { key: "cost", header: "Cost price", numeric: true },
          ...shown.map((l) => ({ key: `loc_${l.id}`, header: l.name, numeric: true })),
          { key: "total", header: "Total", numeric: true },
        ],
        rows: products.map((p) => {
          const per = Object.fromEntries(shown.map((l) => [`loc_${l.id}`, levels[p.id]?.[l.id] ?? 0]));
          return {
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            category: p.category === "CLOTHING" ? "Clothing" : "Accessory",
            price: rupees(p.sellingPrice),
            cost: rupees(p.costPrice),
            ...per,
            total: Object.values(per).reduce((s, n) => s + n, 0),
          };
        }),
      };
    }
    case "low": {
      const shown = location ? locations.filter((l) => l.id === location) : locations;
      const rows: Record<string, string | number>[] = [];
      for (const l of shown) {
        const r = await stockAtLocation(c, l.id, { low: true, includeUnstocked: l.type === "STORE_ROOM", pageSize: MAX_ROWS });
        for (const x of r.rows) rows.push({ location: l.name, name: x.name, sku: x.sku, quantity: x.quantity, reorder: x.reorderLevel, short: Math.max(0, x.reorderLevel * 2 - x.quantity) });
      }
      return {
        type: q.type,
        title,
        truncated: false,
        columns: [
          { key: "location", header: "Location" },
          { key: "name", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "quantity", header: "In stock", numeric: true },
          { key: "reorder", header: "Reorder level", numeric: true },
          { key: "short", header: "Suggested top-up", numeric: true },
        ],
        rows,
      };
    }
    case "dispatches": {
      const list = await listDispatches(c, { toLocationId: location, from, to, pageSize: MAX_ROWS });
      return {
        type: q.type,
        title,
        truncated: list.total > list.rows.length,
        columns: [
          { key: "number", header: "Dispatch" },
          { key: "store", header: "Store" },
          { key: "status", header: "Status" },
          { key: "created", header: "Created" },
          { key: "sent", header: "Sent" },
          { key: "received", header: "Received" },
          { key: "pieces", header: "Pieces sent", numeric: true },
          { key: "good", header: "Pieces received", numeric: true },
          { key: "missing", header: "Missing", numeric: true },
          { key: "damaged", header: "Damaged", numeric: true },
        ],
        rows: list.rows.map((d) => ({
          number: d.number,
          store: locName.get(d.toLocationId) ?? "",
          status: d.status.replace(/_/g, " ").toLowerCase(),
          created: when(d.createdAt),
          sent: when(d.dispatchedAt),
          received: when(d.receivedAt),
          pieces: d.totalPieces,
          good: d.lines.reduce((s, l) => s + (l.receivedQty ?? 0), 0),
          missing: d.lines.reduce((s, l) => s + l.missingQty, 0),
          damaged: d.lines.reduce((s, l) => s + l.damagedQty, 0),
        })),
      };
    }
    case "returns": {
      const list = await listEntries(c, { locationId: location, from, to, pageSize: MAX_ROWS });
      const products = await getProductsByIds(
        c,
        list.rows.map((e) => e.productId),
      );
      return {
        type: q.type,
        title,
        truncated: list.total > list.rows.length,
        columns: [
          { key: "date", header: "Date" },
          { key: "location", header: "Location" },
          { key: "type", header: "Type" },
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "quantity", header: "Pieces", numeric: true },
          { key: "reason", header: "Reason" },
          { key: "status", header: "Status" },
        ],
        rows: list.rows.map((e) => ({
          date: when(e.createdAt),
          location: locName.get(e.locationId) ?? "",
          type: TYPE_LABEL[e.type],
          product: products.get(e.productId)?.name ?? "",
          sku: products.get(e.productId)?.sku ?? "",
          quantity: e.quantity,
          reason: e.reason,
          status: e.status.toLowerCase(),
        })),
      };
    }
    case "movements": {
      const list = await listMovements(c, { locationId: location, from, to, pageSize: MAX_ROWS });
      const products = await getProductsByIds(
        c,
        list.rows.map((m) => m.productId),
      );
      const db = await getDb();
      const people = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.tenantId, c.tenantId));
      const userName = new Map(people.map((u) => [u.id, u.name]));
      return {
        type: q.type,
        title,
        truncated: list.total > list.rows.length,
        columns: [
          { key: "date", header: "Date" },
          { key: "location", header: "Location" },
          { key: "product", header: "Product" },
          { key: "sku", header: "SKU" },
          { key: "type", header: "Movement" },
          { key: "delta", header: "Change", numeric: true },
          { key: "balance", header: "Balance after", numeric: true },
          { key: "ref", header: "Reference" },
          { key: "user", header: "By" },
          { key: "note", header: "Note" },
        ],
        rows: list.rows.map((m) => ({
          date: when(m.createdAt),
          location: locName.get(m.locationId) ?? "",
          product: products.get(m.productId)?.name ?? "",
          sku: products.get(m.productId)?.sku ?? "",
          type: m.type,
          delta: m.quantityDelta,
          balance: m.balanceAfter,
          ref: `${m.refType}:${m.refId}`,
          user: m.userId ? (userName.get(m.userId) ?? "") : "API",
          note: m.note ?? "",
        })),
      };
    }
    case "bills": {
      const [list, suppliers] = await Promise.all([listSupplierBills(c, { from: q.from, to: q.to, pageSize: MAX_ROWS }), listSuppliers(c)]);
      const supName = new Map(suppliers.map((s) => [s.id, s.name]));
      return {
        type: q.type,
        title,
        truncated: list.total > list.rows.length,
        columns: [
          { key: "number", header: "Bill" },
          { key: "supplier", header: "Supplier" },
          { key: "date", header: "Bill date" },
          { key: "due", header: "Due date" },
          { key: "amount", header: "Amount (INR)", numeric: true },
          { key: "status", header: "Status" },
          { key: "overdue", header: "Overdue" },
          { key: "paid", header: "Paid on" },
          { key: "note", header: "Payment note" },
        ],
        rows: list.rows.map((b) => ({
          number: b.billNumber,
          supplier: b.supplierId ? (supName.get(b.supplierId) ?? "") : "",
          date: day(b.billDate),
          due: day(b.dueDate),
          amount: rupees(b.amount),
          status: b.status.toLowerCase(),
          overdue: b.overdue ? "yes" : "no",
          paid: day(b.paidDate),
          note: b.paidNote ?? "",
        })),
      };
    }
  }
}
