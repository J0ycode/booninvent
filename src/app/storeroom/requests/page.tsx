import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-chip";
import { FilterBar, UrlSelect } from "@/components/app/url-filters";
import { getCtx } from "@/server/context";
import { listRequests } from "@/server/data/restock";
import { listLocations } from "@/server/data/locations";
import { dateTime, qtyFmt } from "@/lib/format";
import type { RestockStatus } from "@/server/models/business";

export const metadata: Metadata = { title: "Restock Requests" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function RequestsPage({ searchParams }: PageProps<"/storeroom/requests">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const status = (str(sp.status) ?? "SENT") as RestockStatus | "ALL";
  const store = str(sp.store);
  const page = Number(str(sp.page) ?? 1) || 1;
  const [list, locations] = await Promise.all([
    listRequests(ctx, { status: status === "ALL" ? undefined : status, locationId: store, page }),
    listLocations(ctx),
  ]);
  const locName = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <>
      <PageHeader title="Restock Requests" description="Requests forwarded by the stores. Approving creates a draft dispatch." />
      <FilterBar>
        <UrlSelect
          name="status"
          label="Status"
          options={[
            { value: "", label: "Waiting for you" },
            { value: "APPROVED", label: "Approved" },
            { value: "DISPATCHED", label: "Dispatched" },
            { value: "REJECTED", label: "Rejected" },
            { value: "ALL", label: "All" },
          ]}
        />
        <UrlSelect name="store" label="Store" options={[{ value: "", label: "All stores" }, ...locations.filter((l) => l.type === "STORE").map((s) => ({ value: s.id, label: s.name }))]} />
      </FilterBar>
      {list.rows.length === 0 ? (
        <EmptyState title={status === "SENT" ? "No requests waiting" : "No requests"} description="When a store sends a request, it shows up here." />
      ) : (
        <DataTable
          caption="Restock requests"
          columns={[
            { id: "number", header: "Request", primary: true },
            { id: "store", header: "Store" },
            { id: "status", header: "Status" },
            { id: "pieces", header: "Pieces", align: "right" },
            { id: "date", header: "Sent", hideOnPhone: true },
          ]}
          rows={list.rows.map((r) => ({
            id: r.id,
            href: `/storeroom/requests/${r.id}`,
            cells: {
              number: r.number,
              store: locName.get(r.locationId) ?? "—",
              status: <Status value={r.status} />,
              pieces: qtyFmt(r.approvedPieces),
              date: dateTime(r.sentAt),
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/storeroom/requests" params={{ status: str(sp.status), store }} />
    </>
  );
}
