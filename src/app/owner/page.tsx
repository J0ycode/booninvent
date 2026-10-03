import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatCard, StatGrid } from "@/components/app/stat-card";
import { BarChart } from "@/components/app/bar-chart";
import { DataTable } from "@/components/app/data-table";
import { ActivityList } from "@/components/app/activity-list";
import { getCtx } from "@/server/context";
import { ownerDashboard, setupChecklist } from "@/server/data/dashboard";
import { money, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function OwnerDashboard() {
  const ctx = await getCtx();
  const [d, checklist] = await Promise.all([ownerDashboard(ctx), setupChecklist(ctx)]);
  const approvals = d.pending.returns + d.pending.discrepancies;
  const setupLeft = checklist.filter((c) => !c.done).length;

  return (
    <>
      <PageHeader title="Dashboard" description="Store Room and stores side by side." />
      <div className="flex flex-col gap-6">
        {setupLeft > 0 && (
          <Section title={`Getting started (${checklist.length - setupLeft} of ${checklist.length} done)`}>
            <ul className="flex flex-col gap-1">
              {checklist.map((c) => (
                <li key={c.label}>
                  <Link href={c.href} className="flex min-h-11 items-center gap-3 rounded-lg px-1 text-sm hover:bg-muted">
                    {c.done ? <CheckCircle2 className="size-5 text-mint-foreground" aria-label="Done" /> : <Circle className="size-5 text-muted-foreground" aria-label="To do" />}
                    <span className={c.done ? "text-muted-foreground line-through" : undefined}>{c.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <StatGrid>
          <StatCard label="Pending approvals" value={qtyFmt(approvals)} hint={`${d.pending.requests} restock requests at the Store Room`} href="/owner/approvals" tone={approvals ? "warn" : undefined} />
          <StatCard label="Unpaid supplier bills" value={money(d.supplierBills.unpaidAmount)} hint={`${d.supplierBills.overdueCount} overdue`} tone={d.supplierBills.overdueCount ? "danger" : undefined} href="/owner/bills?status=unpaid" />
          <StatCard label="BoonBaby bills due" value={money(d.platformBills.unpaidAmount)} hint={`${d.platformBills.overdueCount} overdue`} tone={d.platformBills.overdueCount ? "danger" : undefined} href="/owner/billing" />
          <StatCard label="Total pieces" value={qtyFmt(d.locations.reduce((s, l) => s + l.pieces, 0))} hint={`${d.locations.length} locations`} href="/owner/reports" />
        </StatGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <Section>
            <BarChart title="Pieces in stock by location" data={d.locations.map((l) => ({ label: l.name, value: l.pieces }))} />
          </Section>
          <Section title="Locations">
            <DataTable
              caption="Locations"
              columns={[
                { id: "name", header: "Location", primary: true },
                { id: "pieces", header: "Pieces", align: "right" },
                { id: "low", header: "Low stock", align: "right" },
              ]}
              rows={d.locations.map((l) => ({
                id: l.id,
                href: `/owner/reports?type=low&location=${l.id}`,
                cells: {
                  name: l.name,
                  pieces: qtyFmt(l.pieces),
                  low: <span className={l.low ? "font-semibold text-peach-foreground" : undefined}>{qtyFmt(l.low)}</span>,
                },
              }))}
            />
          </Section>
        </div>

        <Section title="Recent activity">
          <ActivityList rows={d.activity} />
        </Section>
      </div>
    </>
  );
}
