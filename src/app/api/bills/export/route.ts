import { ctxFromRequest } from "@/server/context";
import { errorResponse } from "@/server/action";
import { AppError } from "@/server/errors";
import { listSupplierBills, listMyPlatformBills, adminListPlatformBills, adminListShops, type BillStatusFilter, type BillView } from "@/server/data/bills";
import { listSuppliers } from "@/server/data/suppliers";
import { toCsv, csvResponse, rupeesPlain } from "@/lib/csv";
import { isoDay } from "@/lib/format";

/**
 * GET /api/bills/export?kind=supplier|platform&status=&from=&to=&supplier=&tenant=
 * supplier: OWNER / STOREROOM_MANAGER. platform: OWNER (own shop) or PLATFORM_ADMIN (all or one shop).
 */
export async function GET(req: Request) {
  try {
    const ctx = await ctxFromRequest(req);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const sp = new URL(req.url).searchParams;
    const q = {
      status: (sp.get("status") || undefined) as BillStatusFilter | undefined,
      from: sp.get("from") || undefined,
      to: sp.get("to") || undefined,
      supplierId: sp.get("supplier") || undefined,
      tenantId: sp.get("tenant") || undefined,
      pageSize: 10000,
    };
    const kind = sp.get("kind");
    let rows: BillView[];
    let party: (b: BillView) => string;
    let partyHeader: string;
    if (kind === "supplier") {
      const [list, suppliers] = await Promise.all([listSupplierBills(ctx, q), listSuppliers(ctx)]);
      const names = new Map(suppliers.map((s) => [s.id, s.name]));
      rows = list.rows;
      party = (b) => (b.supplierId ? (names.get(b.supplierId) ?? "") : "");
      partyHeader = "Supplier";
    } else if (kind === "platform") {
      if (ctx.role === "PLATFORM_ADMIN") {
        const [list, shops] = await Promise.all([adminListPlatformBills(ctx, q), adminListShops(ctx)]);
        const names = new Map(shops.map((s) => [s.id, s.name]));
        rows = list.rows;
        party = (b) => names.get(b.tenantId) ?? "";
      } else {
        rows = (await listMyPlatformBills(ctx, q)).rows;
        party = () => "";
      }
      partyHeader = "Shop";
    } else {
      throw new AppError("VALIDATION", "kind must be supplier or platform.");
    }
    const csv = toCsv(rows, [
      { header: "Bill number", value: (b) => b.billNumber },
      { header: partyHeader, value: party },
      { header: "Description", value: (b) => b.description },
      { header: kind === "supplier" ? "Bill date" : "Issue date", value: (b) => isoDay(new Date(b.billDate)) },
      { header: "Due date", value: (b) => isoDay(new Date(b.dueDate)) },
      { header: "Amount (INR)", value: (b) => rupeesPlain(b.amount) },
      { header: "Status", value: (b) => b.status },
      { header: "Overdue", value: (b) => (b.overdue ? "Yes" : "No") },
      { header: "Paid date", value: (b) => (b.paidDate ? isoDay(new Date(b.paidDate)) : "") },
      { header: "Payment note", value: (b) => b.paidNote },
      { header: "Note", value: (b) => b.note },
    ]);
    return csvResponse(csv, `${kind}-bills-${isoDay()}.csv`);
  } catch (e) {
    return errorResponse(e);
  }
}
