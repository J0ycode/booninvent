import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { ReturnsForm } from "@/components/app/returns-form";
import { EntriesTable } from "@/components/app/entries-table";
import { Pagination } from "@/components/app/pagination";
import { getCtx } from "@/server/context";
import { listEntries } from "@/server/stock/returns";
import { getProductsByIds } from "@/server/data/products";

export const metadata: Metadata = { title: "Return or Report Damaged" };

export default async function StoreReturnsPage({ searchParams }: PageProps<"/store/returns">) {
  const sp = await searchParams;
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const ctx = await getCtx();
  const entries = await listEntries(ctx, { page });
  const products = await getProductsByIds(
    ctx,
    entries.rows.map((e) => e.productId),
  );
  return (
    <>
      <PageHeader title="Return or Report Damaged" description="Send stock back to the Store Room or report damaged pieces. The Store Room approves each one." />
      <Section title="New entry" className="mb-6">
        <ReturnsForm mode="store" locationId={ctx!.locationIds[0]} />
      </Section>
      <Section title="Your entries">
        {entries.rows.length === 0 ? <p className="text-sm text-muted-foreground">Nothing yet.</p> : <EntriesTable caption="Your entries" entries={entries.rows} products={products} />}
        <Pagination page={entries.page} pageSize={entries.pageSize} total={entries.total} basePath="/store/returns" params={{}} />
      </Section>
    </>
  );
}
