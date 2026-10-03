import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { ReturnsForm } from "@/components/app/returns-form";
import { EntriesTable } from "@/components/app/entries-table";
import { DataTable } from "@/components/app/data-table";
import { Pagination } from "@/components/app/pagination";
import { getCtx } from "@/server/context";
import { listEntries } from "@/server/stock/returns";
import { listDispatches } from "@/server/stock/dispatches";
import { getProductsByIds } from "@/server/data/products";
import { listLocations } from "@/server/data/locations";
import { dateTime, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Returns and Damaged" };

export default async function StoreroomReturnsPage({ searchParams }: PageProps<"/storeroom/returns">) {
  const sp = await searchParams;
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const ctx = await getCtx();
  const [pending, history, issues, locations] = await Promise.all([
    listEntries(ctx, { status: "PENDING", pageSize: 100 }),
    listEntries(ctx, { page }),
    listDispatches(ctx, { status: "RECEIVED_WITH_ISSUES", pageSize: 100 }),
    listLocations(ctx),
  ]);
  const products = await getProductsByIds(ctx, [...pending.rows, ...history.rows].map((e) => e.productId));
  const locName = new Map(locations.map((l) => [l.id, l.name]));
  const storeRoom = locations.find((l) => l.type === "STORE_ROOM")!;

  return (
    <>
      <PageHeader title="Returns and Damaged" description="Approve store returns and write-offs, resolve delivery discrepancies, and record Store Room damage." />
      <div className="flex flex-col gap-6">
        <Section title={`Waiting for approval (${pending.total})`}>
          {pending.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to approve.</p>
          ) : (
            <EntriesTable caption="Waiting for approval" entries={pending.rows} products={products} locName={locName} decide />
          )}
        </Section>
        <Section title={`Delivery discrepancies (${issues.total})`}>
          {issues.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open discrepancies.</p>
          ) : (
            <DataTable
              caption="Delivery discrepancies"
              columns={[
                { id: "number", header: "Dispatch", primary: true },
                { id: "store", header: "Store" },
                { id: "pieces", header: "Missing / damaged", align: "right" },
                { id: "date", header: "Received" },
              ]}
              rows={issues.rows.map((d) => ({
                id: d.id,
                href: `/storeroom/dispatch/${d.id}`,
                cells: { number: d.number, store: locName.get(d.toLocationId) ?? "—", pieces: qtyFmt(d.issuePieces), date: dateTime(d.receivedAt) },
              }))}
            />
          )}
        </Section>
        <Section title="Record Store Room damage or supplier return">
          <ReturnsForm mode="storeroom" locationId={storeRoom.id} />
        </Section>
        <Section title="History">
          <EntriesTable caption="Returns history" entries={history.rows} products={products} locName={locName} />
          <Pagination page={history.page} pageSize={history.pageSize} total={history.total} basePath="/storeroom/returns" params={{}} />
        </Section>
      </div>
    </>
  );
}
