import { ctxFromRequest } from "@/server/context";
import { errorResponse } from "@/server/action";
import { AppError } from "@/server/errors";
import { buildReport } from "@/server/data/reports";
import { toCsv, csvResponse } from "@/lib/csv";
import { isoDay } from "@/lib/format";

/** GET /api/reports/:type?location=&from=&to= -> CSV. OWNER and STOREROOM_MANAGER only. */
export async function GET(req: Request, { params }: RouteContext<"/api/reports/[type]">) {
  try {
    const ctx = await ctxFromRequest(req);
    if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in.");
    const { type } = await params;
    const sp = new URL(req.url).searchParams;
    const report = await buildReport(ctx, { type, location: sp.get("location") || undefined, from: sp.get("from") || undefined, to: sp.get("to") || undefined });
    const csv = toCsv(
      report.rows,
      report.columns.map((c) => ({ header: c.header, value: (r: Record<string, string | number>) => r[c.key] })),
    );
    return csvResponse(csv, `${report.type}-report-${isoDay()}.csv`);
  } catch (e) {
    return errorResponse(e);
  }
}
