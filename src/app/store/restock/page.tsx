import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { Status } from "@/components/app/status-chip";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { listRequests } from "@/server/data/restock";
import { dateTime, qtyFmt } from "@/lib/format";
import { SuggestButton } from "./suggest-button";

export const metadata: Metadata = { title: "Request Restock" };

export default async function RestockPage({ searchParams }: PageProps<"/store/restock">) {
  const sp = await searchParams;
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const list = await listRequests(await getCtx(), { page });
  return (
    <>
      <PageHeader
        title="Request Restock"
        description="Ask the Store Room for more stock. Suggestions stay private until you forward them."
        actions={
          <>
            <SuggestButton />
            <Link href="/store/restock/new" className={buttonVariants()}>
              <Plus /> New request
            </Link>
          </>
        }
      />
      {list.rows.length === 0 ? (
        <EmptyState title="No requests yet" description="Create a request yourself, or press Suggest restock to list items that are running low." />
      ) : (
        <DataTable
          caption="Restock requests"
          columns={[
            { id: "number", header: "Request", primary: true },
            { id: "source", header: "Type" },
            { id: "status", header: "Status" },
            { id: "pieces", header: "Pieces", align: "right" },
            { id: "date", header: "Date", hideOnPhone: true },
          ]}
          rows={list.rows.map((r) => ({
            id: r.id,
            href: `/store/restock/${r.id}`,
            cells: {
              number: r.number,
              source: r.source === "SUGGESTED" ? "Suggested" : "Manual",
              status: <Status value={r.status} />,
              pieces: r.status === "WAITING_STAFF_APPROVAL" ? `${r.pendingLines} to review` : qtyFmt(r.approvedPieces),
              date: dateTime(r.sentAt ?? r.createdAt),
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/store/restock" params={{}} />
    </>
  );
}
