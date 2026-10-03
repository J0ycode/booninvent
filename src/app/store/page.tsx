import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { StatCard, StatGrid } from "@/components/app/stat-card";
import { ActivityList } from "@/components/app/activity-list";
import { getCtx } from "@/server/context";
import { storeDashboard } from "@/server/data/dashboard";
import { listLocations } from "@/server/data/locations";
import { qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

export default async function StoreDashboard() {
  const ctx = await getCtx();
  const [d, locations] = await Promise.all([storeDashboard(ctx), listLocations(ctx)]);
  const name = locations.find((l) => l.id === d.locationId)?.name ?? "Your store";
  return (
    <>
      <PageHeader title={name} description="Your store at a glance." />
      <div className="flex flex-col gap-6">
        <StatGrid>
          <StatCard label="Pieces in stock" value={qtyFmt(d.pieces)} hint={`${d.products} products`} href="/store/stock" />
          <StatCard label="Low stock" value={qtyFmt(d.low)} tone={d.low ? "warn" : undefined} href="/store/stock?low=1" />
          <StatCard label="Dispatches to confirm" value={qtyFmt(d.incoming)} tone={d.incoming ? "warn" : undefined} href="/store/incoming" />
          <StatCard
            label="Waiting for approval"
            value={qtyFmt(d.entries)}
            hint={d.waiting ? "Plus a restock suggestion to review" : "Returns and damage reports"}
            href={d.waiting ? "/store/restock" : "/store/returns"}
          />
        </StatGrid>
        <Section title="Recent activity">
          <ActivityList rows={d.activity} showLocation={false} />
        </Section>
      </div>
    </>
  );
}
