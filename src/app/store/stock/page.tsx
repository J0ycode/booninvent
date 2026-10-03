import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { ScanSearch } from "@/components/app/scan-search";
import { StatusChip } from "@/components/app/status-chip";
import { FilterBar, UrlSelect } from "@/components/app/url-filters";
import { getCtx } from "@/server/context";
import { stockAtLocation } from "@/server/stock/read";
import { money, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "My Stock" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function MyStockPage({ searchParams }: PageProps<"/store/stock">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const q = str(sp.q);
  const low = str(sp.low) === "1";
  const page = Number(str(sp.page) ?? 1) || 1;
  const list = await stockAtLocation(ctx, ctx!.locationIds[0], { q, low, page });
  return (
    <>
      <PageHeader title="My Stock" description={`${qtyFmt(list.pieces)} pieces across ${qtyFmt(list.total)} products${low ? " (low stock only)" : ""}.`} />
      <div className="mb-3">
        <ScanSearch />
      </div>
      <FilterBar>
        <UrlSelect
          name="low"
          label="Show"
          options={[
            { value: "", label: "All products" },
            { value: "1", label: "Low stock only" },
          ]}
        />
      </FilterBar>
      {list.rows.length === 0 ? (
        <EmptyState title={q || low ? "Nothing matches" : "No stock yet"} description={q || low ? "Try another search or filter." : "Stock appears here after you confirm a dispatch from the Store Room."} />
      ) : (
        <DataTable
          caption="My stock"
          columns={[
            { id: "name", header: "Product", primary: true },
            { id: "sku", header: "SKU" },
            { id: "price", header: "Price", align: "right", hideOnPhone: true },
            { id: "qty", header: "In stock", align: "right" },
            { id: "status", header: "" },
          ]}
          rows={list.rows.map((r) => ({
            id: r.productId,
            cells: {
              name: r.name,
              sku: <span className="num">{r.sku}</span>,
              price: money(r.sellingPrice),
              qty: <span className="font-semibold">{qtyFmt(r.quantity)}</span>,
              status: r.quantity === 0 ? <StatusChip tone="danger">Out of stock</StatusChip> : r.reorderLevel > 0 && r.quantity <= r.reorderLevel ? <StatusChip tone="peach">Low</StatusChip> : null,
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/store/stock" params={{ q, low: low ? "1" : undefined }} />
    </>
  );
}
