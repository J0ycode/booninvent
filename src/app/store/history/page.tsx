import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { FilterBar, UrlSelect, UrlDate } from "@/components/app/url-filters";
import { MOVEMENT_LABEL } from "@/components/app/activity-list";
import { getCtx } from "@/server/context";
import { listMovements } from "@/server/stock/read";
import { getProductsByIds } from "@/server/data/products";
import { parseDayIST, endOfDayIST } from "@/lib/dates";
import { dateTime, qtyFmt } from "@/lib/format";
import type { MovementType } from "@/server/db/types";

export const metadata: Metadata = { title: "Stock History" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const STORE_TYPES: MovementType[] = ["DISPATCH_IN", "SALE", "RETURN_OUT", "DAMAGE"];

export default async function HistoryPage({ searchParams }: PageProps<"/store/history">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const type = str(sp.type) as MovementType | undefined;
  const from = str(sp.from);
  const to = str(sp.to);
  const page = Number(str(sp.page) ?? 1) || 1;
  const list = await listMovements(ctx, {
    types: type ? [type] : undefined,
    from: from ? (parseDayIST(from) ?? undefined) : undefined,
    to: to ? (endOfDayIST(to) ?? undefined) : undefined,
    page,
  });
  const products = await getProductsByIds(
    ctx,
    list.rows.map((m) => m.productId),
  );
  return (
    <>
      <PageHeader title="Stock History" description="Every change to your store's stock, newest first." />
      <FilterBar>
        <UrlSelect name="type" label="Type" options={[{ value: "", label: "All changes" }, ...STORE_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABEL[t] }))]} />
        <UrlDate name="from" label="From" />
        <UrlDate name="to" label="To" />
      </FilterBar>
      {list.rows.length === 0 ? (
        <EmptyState title="No changes" description="Nothing matches these filters." />
      ) : (
        <DataTable
          caption="Stock history"
          columns={[
            { id: "product", header: "Product", primary: true },
            { id: "type", header: "What happened" },
            { id: "delta", header: "Change", align: "right" },
            { id: "balance", header: "Balance", align: "right" },
            { id: "date", header: "When" },
          ]}
          rows={list.rows.map((m) => ({
            id: m.id,
            cells: {
              product: products.get(m.productId)?.name ?? "Product",
              type: (
                <span>
                  {MOVEMENT_LABEL[m.type] ?? m.type}
                  {m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}
                </span>
              ),
              delta: <span className={m.quantityDelta < 0 ? "text-destructive" : "text-mint-foreground"}>{m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}</span>,
              balance: qtyFmt(m.balanceAfter),
              date: dateTime(m.createdAt),
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/store/history" params={{ type, from, to }} />
    </>
  );
}
