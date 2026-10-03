import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/server/context";
import { listReceipts } from "@/server/stock/receipts";
import { listSuppliers } from "@/server/data/suppliers";
import { date } from "@/lib/format";
import { LabelsClient } from "./labels-client";

export const metadata: Metadata = { title: "Barcode Labels" };

export default async function LabelsPage({ searchParams }: PageProps<"/storeroom/labels">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const [receipts, suppliers] = await Promise.all([listReceipts(ctx, { pageSize: 20 }), listSuppliers(ctx)]);
  const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
  const initial = typeof sp.receipt === "string" ? sp.receipt : undefined;
  return (
    <>
      <PageHeader title="Barcode Labels" description="Print price and barcode stickers on A4 sheets." />
      <LabelsClient
        initialReceiptId={initial && receipts.rows.some((r) => r.id === initial) ? initial : undefined}
        receipts={receipts.rows.map((r) => ({
          id: r.id,
          label: `${r.number} · ${supplierName.get(r.supplierId) ?? ""} · ${date(r.createdAt)} · ${r.totalPieces} pcs`,
        }))}
      />
    </>
  );
}
