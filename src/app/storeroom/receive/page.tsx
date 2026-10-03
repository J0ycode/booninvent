import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { listSuppliers } from "@/server/data/suppliers";
import { listReceipts } from "@/server/stock/receipts";
import { dateTime, qtyFmt } from "@/lib/format";
import { ReceiveForm } from "./receive-form";

export const metadata: Metadata = { title: "Receive Stock" };

export default async function ReceivePage() {
  const ctx = await getCtx();
  const [suppliers, recent] = await Promise.all([listSuppliers(ctx, { activeOnly: true }), listReceipts(ctx, { pageSize: 10 })]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));

  return (
    <>
      <PageHeader title="Receive Stock" description="Record a supplier delivery. The pieces are added to the Store Room." />
      {suppliers.length === 0 ? (
        <EmptyState
          title="Add a supplier first"
          description="Every delivery is linked to a supplier."
          action={
            <Link className={buttonVariants()} href="/storeroom/products/suppliers">
              Add supplier
            </Link>
          }
        />
      ) : (
        <ReceiveForm suppliers={suppliers} />
      )}
      <Section title="Recent receipts" className="mt-8">
        {recent.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No receipts yet.</p>
        ) : (
          <DataTable
            caption="Recent receipts"
            columns={[
              { id: "number", header: "Receipt", primary: true },
              { id: "supplier", header: "Supplier" },
              { id: "invoice", header: "Invoice" },
              { id: "pieces", header: "Pieces", align: "right" },
              { id: "date", header: "Date" },
            ]}
            rows={recent.rows.map((r) => ({
              id: r.id,
              href: `/storeroom/receive/${r.id}`,
              cells: {
                number: r.number,
                supplier: supplierName.get(r.supplierId) ?? "—",
                invoice: r.invoiceNumber,
                pieces: qtyFmt(r.totalPieces),
                date: dateTime(r.createdAt),
              },
            }))}
          />
        )}
      </Section>
    </>
  );
}
