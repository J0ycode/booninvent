import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Status } from "@/components/app/status-chip";
import { BillTotalsCards } from "@/components/app/bills/bills-view";
import { ScanSearch } from "@/components/app/scan-search";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { adminListShops, adminListPlatformBills } from "@/server/data/bills";
import { date, money } from "@/lib/format";
import { Download } from "lucide-react";

export const metadata: Metadata = { title: "Shops" };

export default async function AdminShopsPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const ctx = await getCtx();
  const [shops, bills] = await Promise.all([adminListShops(ctx, { search }), adminListPlatformBills(ctx, { pageSize: 1 })]);
  return (
    <>
      <PageHeader
        title="Shops"
        description="Every shop using the app, with its platform bills."
        actions={
          <a href="/api/bills/export?kind=platform" className={buttonVariants({ variant: "outline" })}>
            <Download /> Export all bills
          </a>
        }
      />
      <div className="mb-4">
        <BillTotalsCards totals={bills.totals} />
      </div>
      <div className="mb-4">
        <ScanSearch placeholder="Search shops by name" scan={false} />
      </div>
      {shops.length === 0 ? (
        <EmptyState title="No shops" description={search ? "No shop matches that name." : "Shops appear here after they sign up."} />
      ) : (
        <DataTable
          caption="Shops"
          columns={[
            { id: "name", header: "Shop", primary: true },
            { id: "owner", header: "Owner email" },
            { id: "status", header: "Status" },
            { id: "unpaid", header: "Unpaid bills", align: "right" },
            { id: "since", header: "Joined", hideOnPhone: true },
          ]}
          rows={shops.map((s) => ({
            id: s.id,
            href: `/admin/shops/${s.id}`,
            cells: {
              name: s.name,
              owner: <span className="break-all">{s.ownerEmail ?? "—"}</span>,
              status: <Status value={s.status} />,
              unpaid: s.unpaidCount ? (
                <span className={s.overdueCount ? "font-semibold text-destructive" : undefined}>
                  {s.unpaidCount} · {money(s.unpaidAmount)}
                </span>
              ) : (
                "—"
              ),
              since: date(s.createdAt),
            },
          }))}
        />
      )}
    </>
  );
}
