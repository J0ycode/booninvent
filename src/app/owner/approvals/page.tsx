import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { EntriesTable } from "@/components/app/entries-table";
import { EmptyState } from "@/components/app/empty-state";
import { getCtx } from "@/server/context";
import { listEntries } from "@/server/stock/returns";
import { listDispatches } from "@/server/stock/dispatches";
import { getProductsByIds } from "@/server/data/products";
import { listLocations } from "@/server/data/locations";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const ctx = await getCtx();
  const [pending, issues, locations] = await Promise.all([
    listEntries(ctx, { status: "PENDING", pageSize: 100 }),
    listDispatches(ctx, { status: "RECEIVED_WITH_ISSUES", pageSize: 1 }),
    listLocations(ctx),
  ]);
  const products = await getProductsByIds(
    ctx,
    pending.rows.map((e) => e.productId),
  );
  return (
    <>
      <PageHeader title="Approvals" description="Store returns and write-offs waiting for a decision. Your Store Room manager can also approve these." />
      <Section>
        {pending.rows.length === 0 ? (
          <EmptyState title="Nothing waiting" description="New return and damage reports from the stores appear here." />
        ) : (
          <EntriesTable caption="Waiting for approval" entries={pending.rows} products={products} locName={new Map(locations.map((l) => [l.id, l.name]))} decide />
        )}
        {issues.total > 0 && (
          <p className="mt-4 text-sm text-muted-foreground">
            {issues.total} delivery {issues.total === 1 ? "discrepancy is" : "discrepancies are"} waiting for the Store Room manager.
          </p>
        )}
      </Section>
    </>
  );
}
