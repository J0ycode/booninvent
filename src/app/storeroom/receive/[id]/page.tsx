import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Tag } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { getReceipt } from "@/server/stock/receipts";
import { getProductsByIds } from "@/server/data/products";
import { listSuppliers } from "@/server/data/suppliers";
import { AppError } from "@/server/errors";
import { dateTime, money, qtyFmt } from "@/lib/format";

export const metadata: Metadata = { title: "Receipt" };

export default async function ReceiptPage({ params }: PageProps<"/storeroom/receive/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const receipt = await getReceipt(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [products, suppliers] = await Promise.all([getProductsByIds(ctx, receipt.lines.map((l) => l.productId)), listSuppliers(ctx)]);
  const supplier = suppliers.find((s) => s.id === receipt.supplierId);

  return (
    <>
      <PageHeader
        title={receipt.number}
        description={`${supplier?.name ?? "Supplier"} · Invoice ${receipt.invoiceNumber} · ${dateTime(receipt.createdAt)}`}
        back={{ href: "/storeroom/receive", label: "Receive Stock" }}
        actions={
          <Link href={`/storeroom/labels?receipt=${receipt.id}`} className={buttonVariants({ variant: "outline" })}>
            <Tag /> Print labels
          </Link>
        }
      />
      <Section>
        <DataTable
          caption="Received products"
          columns={[
            { id: "name", header: "Product", primary: true },
            { id: "sku", header: "SKU" },
            { id: "qty", header: "Pieces", align: "right" },
            { id: "cost", header: "Cost / piece", align: "right" },
          ]}
          rows={receipt.lines.map((l) => {
            const p = products.get(l.productId);
            return {
              id: l.productId,
              cells: { name: p?.name ?? "Deleted product", sku: <span className="num">{p?.sku}</span>, qty: qtyFmt(l.quantity), cost: money(l.cost) },
            };
          })}
        />
        <p className="num mt-3 text-right text-sm font-semibold">Total {qtyFmt(receipt.totalPieces)} pieces</p>
        {receipt.note && <p className="mt-2 text-sm text-muted-foreground">Note: {receipt.note}</p>}
      </Section>
    </>
  );
}
