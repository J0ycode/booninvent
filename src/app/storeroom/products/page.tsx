import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Upload, Truck } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { ScanSearch } from "@/components/app/scan-search";
import { StatusChip } from "@/components/app/status-chip";
import { FilterBar, UrlSelect } from "@/components/app/url-filters";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { listProducts } from "@/server/data/products";
import { listSuppliers } from "@/server/data/suppliers";
import { getStoreRoom } from "@/server/data/locations";
import { getLevels } from "@/server/stock/read";
import { money, qtyFmt } from "@/lib/format";
import type { Category } from "@/server/models/business";

export const metadata: Metadata = { title: "Products" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

export default async function ProductsPage({ searchParams }: PageProps<"/storeroom/products">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const q = str(sp.q);
  const category = str(sp.category) as Category | undefined;
  const status = (str(sp.status) as "active" | "inactive" | "all" | undefined) ?? "active";
  const supplierId = str(sp.supplier);
  const page = Number(str(sp.page) ?? 1) || 1;

  const [list, suppliers, storeRoom] = await Promise.all([
    listProducts(ctx, { q, category, status, supplierId, page }),
    listSuppliers(ctx),
    getStoreRoom(ctx),
  ]);
  const levels = await getLevels(
    ctx,
    list.rows.map((p) => p.id),
    [storeRoom.id],
  );
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader
        title="Products"
        description="Every product, its barcode and Store Room stock."
        actions={
          <>
            <Link href="/storeroom/products/suppliers" className={buttonVariants({ variant: "outline" })}>
              <Truck /> Suppliers
            </Link>
            <Link href="/storeroom/products/import" className={buttonVariants({ variant: "outline" })}>
              <Upload /> Import CSV
            </Link>
            <Link href="/storeroom/products/new" className={buttonVariants()}>
              <Plus /> Add product
            </Link>
          </>
        }
      />
      <div className="mb-3">
        <ScanSearch />
      </div>
      <FilterBar>
        <UrlSelect
          name="category"
          label="Category"
          options={[
            { value: "", label: "All categories" },
            { value: "CLOTHING", label: "Clothing" },
            { value: "ACCESSORY", label: "Accessory" },
          ]}
        />
        <UrlSelect name="supplier" label="Supplier" options={[{ value: "", label: "All suppliers" }, ...suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
        <UrlSelect
          name="status"
          label="Status"
          options={[
            { value: "", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "all", label: "All" },
          ]}
        />
      </FilterBar>

      {list.rows.length === 0 ? (
        <EmptyState
          title={q ? "No products match your search" : "No products yet"}
          description={q ? "Try another name, SKU or barcode." : "Add your first product or import a CSV file."}
          action={
            !q && (
              <Link href="/storeroom/products/new" className={buttonVariants()}>
                <Plus /> Add product
              </Link>
            )
          }
        />
      ) : (
        <DataTable
          caption="Products"
          columns={[
            { id: "name", header: "Product", primary: true },
            { id: "sku", header: "SKU" },
            { id: "barcode", header: "Barcode", hideOnPhone: true },
            { id: "category", header: "Category", hideOnPhone: true },
            { id: "supplier", header: "Supplier", hideOnPhone: true },
            { id: "price", header: "Price", align: "right" },
            { id: "cost", header: "Cost", align: "right", hideOnPhone: true },
            { id: "qty", header: "Store Room", align: "right" },
          ]}
          rows={list.rows.map((p) => {
            const qty = levels[p.id]?.[storeRoom.id] ?? 0;
            return {
              id: p.id,
              href: `/storeroom/products/${p.id}`,
              cells: {
                name: (
                  <span className="flex flex-wrap items-center gap-2">
                    {p.name}
                    {!p.active && <StatusChip tone="neutral">Inactive</StatusChip>}
                  </span>
                ),
                sku: <span className="num">{p.sku}</span>,
                barcode: <span className="num text-muted-foreground">{p.barcode}</span>,
                category: p.category === "CLOTHING" ? "Clothing" : "Accessory",
                supplier: p.supplierId ? (supplierName.get(p.supplierId) ?? "—") : "—",
                price: money(p.sellingPrice),
                cost: money(p.costPrice),
                qty: (
                  <span className={qty <= p.reorderLevel ? "font-semibold text-peach-foreground" : undefined}>
                    {qtyFmt(qty)}
                  </span>
                ),
              },
            };
          })}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/storeroom/products" params={{ q, category, status: str(sp.status), supplier: supplierId }} />
    </>
  );
}
