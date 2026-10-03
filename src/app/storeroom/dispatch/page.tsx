import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-chip";
import { FilterBar, UrlSelect } from "@/components/app/url-filters";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { listDispatches } from "@/server/stock/dispatches";
import { listLocations } from "@/server/data/locations";
import { dateTime, qtyFmt } from "@/lib/format";
import type { DispatchStatus } from "@/server/models/business";

export const metadata: Metadata = { title: "Dispatch" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const STATUSES: { value: string; label: string }[] = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "DISPATCHED", label: "Dispatched (in transit)" },
  { value: "RECEIVED", label: "Received" },
  { value: "RECEIVED_WITH_ISSUES", label: "Received with issues" },
  { value: "RESOLVED", label: "Resolved" },
];

export default async function DispatchListPage({ searchParams }: PageProps<"/storeroom/dispatch">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const status = str(sp.status) as DispatchStatus | undefined;
  const store = str(sp.store);
  const page = Number(str(sp.page) ?? 1) || 1;
  const [list, locations] = await Promise.all([listDispatches(ctx, { status, toLocationId: store, page }), listLocations(ctx)]);
  const stores = locations.filter((l) => l.type === "STORE");
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <>
      <PageHeader
        title="Dispatch"
        description="Send stock from the Store Room to a store."
        actions={
          <Link href="/storeroom/dispatch/new" className={buttonVariants()}>
            <Plus /> New dispatch
          </Link>
        }
      />
      <FilterBar>
        <UrlSelect name="status" label="Status" options={STATUSES} />
        <UrlSelect name="store" label="Store" options={[{ value: "", label: "All stores" }, ...stores.map((s) => ({ value: s.id, label: s.name }))]} />
      </FilterBar>
      {list.rows.length === 0 ? (
        <EmptyState title="No dispatches" description="Create a dispatch, or approve a restock request to start one." />
      ) : (
        <DataTable
          caption="Dispatches"
          columns={[
            { id: "number", header: "Dispatch", primary: true },
            { id: "to", header: "To" },
            { id: "status", header: "Status" },
            { id: "pieces", header: "Pieces", align: "right" },
            { id: "date", header: "Updated", hideOnPhone: true },
          ]}
          rows={list.rows.map((d) => ({
            id: d.id,
            href: `/storeroom/dispatch/${d.id}`,
            cells: {
              number: d.number,
              to: locName.get(d.toLocationId) ?? "—",
              status: <Status value={d.status} />,
              pieces: qtyFmt(d.totalPieces),
              date: dateTime(d.receivedAt ?? d.dispatchedAt ?? d.createdAt),
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/storeroom/dispatch" params={{ status, store }} />
    </>
  );
}
