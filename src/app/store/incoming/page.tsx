import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Status } from "@/components/app/status-chip";
import { Pagination } from "@/components/app/pagination";
import { getCtx } from "@/server/context";
import { listDispatches, type DispatchView } from "@/server/stock/dispatches";
import { dateTime, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Incoming Dispatches" };

function rows(list: DispatchView[]) {
  return list.map((d) => ({
    id: d.id,
    href: `/store/incoming/${d.id}`,
    cells: {
      number: d.number,
      status: <Status value={d.status} />,
      pieces: qtyFmt(d.totalPieces),
      sent: dateTime(d.dispatchedAt),
    },
  }));
}
const columns = [
  { id: "number", header: "Dispatch", primary: true },
  { id: "status", header: "Status" },
  { id: "pieces", header: "Pieces", align: "right" as const },
  { id: "sent", header: "Sent" },
];

export default async function IncomingPage({ searchParams }: PageProps<"/store/incoming">) {
  const sp = await searchParams;
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const ctx = await getCtx();
  const [waiting, history] = await Promise.all([
    listDispatches(ctx, { status: "DISPATCHED", pageSize: 100 }),
    listDispatches(ctx, { status: ["RECEIVED", "RECEIVED_WITH_ISSUES", "RESOLVED"], page }),
  ]);
  return (
    <>
      <PageHeader title="Incoming Dispatches" description="Check each delivery from the Store Room and confirm what arrived." />
      <Section title="To confirm" className="mb-6">
        {waiting.rows.length === 0 ? (
          <EmptyState title="Nothing on the way" description="Dispatches sent to your store appear here." />
        ) : (
          <DataTable caption="Dispatches to confirm" columns={columns} rows={rows(waiting.rows)} />
        )}
      </Section>
      <Section title="Received">
        {history.rows.length === 0 ? <p className="text-sm text-muted-foreground">No received dispatches yet.</p> : <DataTable caption="Received dispatches" columns={columns} rows={rows(history.rows)} />}
        <Pagination page={history.page} pageSize={history.pageSize} total={history.total} basePath="/store/incoming" params={{}} />
      </Section>
    </>
  );
}
