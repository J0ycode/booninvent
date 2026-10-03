import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatCard, StatGrid } from "@/components/app/stat-card";
import { ActivityList } from "@/components/app/activity-list";
import { getCtx } from "@/server/context";
import { storeroomDashboard } from "@/server/data/dashboard";
import { money, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function StoreroomDashboard() {
  const d = await storeroomDashboard(await getCtx());
  const waiting = d.pending.requests + d.pending.returns + d.pending.discrepancies;
  return (
    <>
      <PageHeader title="Dashboard" description="Store Room at a glance." />
      <div className="flex flex-col gap-6">
        <StatGrid>
          <StatCard label="Products" value={qtyFmt(d.products)} href="/storeroom/products" />
          <StatCard label="Pieces in Store Room" value={qtyFmt(d.pieces)} />
          <StatCard label="Low stock" value={qtyFmt(d.low)} tone={d.low ? "warn" : undefined} href="/storeroom/reports?type=low" />
          <StatCard
            label="Pending requests"
            value={qtyFmt(d.pending.requests)}
            hint={waiting > d.pending.requests ? `${d.pending.returns} returns · ${d.pending.discrepancies} discrepancies` : undefined}
            href="/storeroom/requests"
          />
          <StatCard label="Unpaid bills" value={money(d.bills.unpaidAmount)} hint={`${d.bills.unpaidCount} unpaid`} href="/storeroom/bills?status=unpaid" />
          <StatCard
            label="Overdue bills"
            value={money(d.bills.overdueAmount)}
            hint={`${d.bills.overdueCount} overdue`}
            tone={d.bills.overdueCount ? "danger" : undefined}
            href="/storeroom/bills?status=overdue"
          />
        </StatGrid>
        <Section title="Recent activity">
          <ActivityList rows={d.activity} />
        </Section>
      </div>
    </>
  );
}
