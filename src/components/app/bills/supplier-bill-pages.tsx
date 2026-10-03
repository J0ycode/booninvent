import { notFound } from "next/navigation";
import { PageHeader } from "../page-header";
import { Section } from "../section";
import { BillsView, BillDetailList, receiptLink } from "./bills-view";
import { SupplierBillDialog } from "./supplier-bill-form";
import { MarkPaidButton, MarkUnpaidButton, DeleteBillButton } from "./bill-actions";
import { getCtx } from "@/server/context";
import { listSupplierBills, getSupplierBill, type BillStatusFilter } from "@/server/data/bills";
import { listSuppliers } from "@/server/data/suppliers";
import { listReceipts } from "@/server/stock/receipts";
import { AppError } from "@/server/errors";
import { date } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

async function formData() {
  const ctx = await getCtx();
  const [suppliers, receipts] = await Promise.all([listSuppliers(ctx), listReceipts(ctx, { pageSize: 50 })]);
  return {
    suppliers: suppliers.map((s) => ({ id: s.id, name: s.name })),
    receipts: receipts.rows.map((r) => ({ id: r.id, supplierId: r.supplierId, label: `${r.number} · ${r.invoiceNumber} · ${date(r.createdAt)}` })),
  };
}

/** Supplier bills list, shared by Owner and Store Room portals. */
export async function SupplierBillsPage({ sp, basePath }: { sp: SP; basePath: string }) {
  const ctx = await getCtx();
  const q = { status: str(sp.status) as BillStatusFilter | undefined, from: str(sp.from), to: str(sp.to), supplierId: str(sp.supplier), page: Number(str(sp.page) ?? 1) || 1 };
  const [list, fd] = await Promise.all([listSupplierBills(ctx, q), formData()]);
  const supplierName = new Map(fd.suppliers.map((s) => [s.id, s.name]));
  const params = { status: q.status, from: q.from, to: q.to, supplier: q.supplierId };
  const exportQ = new URLSearchParams({ kind: "supplier", ...(Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>) });
  return (
    <>
      <PageHeader title="Bills" description="Supplier bills. Record them and mark them paid by hand." actions={<SupplierBillDialog suppliers={fd.suppliers} receipts={fd.receipts} basePath={basePath} />} />
      <BillsView
        list={list}
        basePath={basePath}
        params={params}
        partyLabel="Supplier"
        partyParam="supplier"
        partyOptions={fd.suppliers.map((s) => ({ value: s.id, label: s.name }))}
        partyName={(b) => (b.supplierId ? (supplierName.get(b.supplierId) ?? "—") : "—")}
        exportHref={`/api/bills/export?${exportQ.toString()}`}
        markPaid="SUPPLIER"
      />
    </>
  );
}

export async function SupplierBillDetailPage({ id, basePath, receiptBase }: { id: string; basePath: string; receiptBase?: string }) {
  const ctx = await getCtx();
  const bill = await getSupplierBill(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const fd = await formData();
  const supplier = fd.suppliers.find((s) => s.id === bill.supplierId);
  const receipt = fd.receipts.find((r) => r.id === bill.receiptId);
  return (
    <>
      <PageHeader
        title={bill.billNumber}
        description={supplier?.name}
        back={{ href: basePath, label: "Bills" }}
        actions={
          bill.status === "UNPAID" ? (
            <>
              <SupplierBillDialog suppliers={fd.suppliers} receipts={fd.receipts} bill={bill} basePath={basePath} />
              <DeleteBillButton kind="SUPPLIER" id={bill.id} billNumber={bill.billNumber} after={basePath} />
              <MarkPaidButton kind="SUPPLIER" id={bill.id} billNumber={bill.billNumber} amount={bill.amount} size="default" />
            </>
          ) : (
            <MarkUnpaidButton kind="SUPPLIER" id={bill.id} billNumber={bill.billNumber} />
          )
        }
      />
      <Section>
        <BillDetailList
          bill={bill}
          extra={[
            ["Supplier", supplier?.name ?? "—"],
            ["Stock receipt", receipt ? (receiptBase ? receiptLink(`${receiptBase}/${receipt.id}`, receipt.label) : receipt.label) : "—"],
          ]}
        />
        {bill.status === "PAID" && <p className="mt-4 text-xs text-muted-foreground">Paid bills are locked. Mark it unpaid to edit or delete it.</p>}
      </Section>
    </>
  );
}
