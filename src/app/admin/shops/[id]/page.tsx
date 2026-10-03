import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Status } from "@/components/app/status-chip";
import { Pagination } from "@/components/app/pagination";
import { BillStatus, BillTotalsCards, BILL_STATUS_OPTIONS } from "@/components/app/bills/bills-view";
import { MarkPaidButton, MarkUnpaidButton, DeleteBillButton } from "@/components/app/bills/bill-actions";
import { FilterBar, UrlSelect, UrlDate } from "@/components/app/url-filters";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { adminGetShop, adminListPlatformBills, type BillStatusFilter } from "@/server/data/bills";
import { AppError } from "@/server/errors";
import { date, money } from "@/lib/format";
import { ShopStatusButton, PlatformBillDialog } from "./shop-controls";

export const metadata: Metadata = { title: "Shop" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

export default async function AdminShopPage({ params, searchParams }: PageProps<"/admin/shops/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await getCtx();
  const shop = await adminGetShop(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const q = { tenantId: id, status: str(sp.status) as BillStatusFilter | undefined, from: str(sp.from), to: str(sp.to), page: Number(str(sp.page) ?? 1) || 1 };
  const list = await adminListPlatformBills(ctx, q);
  const exportQ = new URLSearchParams({ kind: "platform", tenant: id, ...(q.status ? { status: q.status } : {}), ...(q.from ? { from: q.from } : {}), ...(q.to ? { to: q.to } : {}) });

  return (
    <>
      <PageHeader
        title={shop.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Status value={shop.status} /> Owner: {shop.ownerName ?? "—"} ({shop.ownerEmail ?? "no owner"}) · joined {date(shop.createdAt)}
          </span>
        }
        back={{ href: "/admin", label: "Shops" }}
        actions={<ShopStatusButton tenantId={shop.id} status={shop.status} name={shop.name} />}
      />
      <div className="flex flex-col gap-4">
        <BillTotalsCards totals={list.totals} />
        <Section
          title="Platform bills"
          actions={
            <span className="flex gap-2">
              <a href={`/api/bills/export?${exportQ.toString()}`} className={buttonVariants({ variant: "outline" })}>
                <Download /> CSV
              </a>
              <PlatformBillDialog tenantId={shop.id} />
            </span>
          }
        >
          <FilterBar>
            <UrlSelect name="status" label="Status" options={BILL_STATUS_OPTIONS} />
            <UrlDate name="from" label="Issued from" />
            <UrlDate name="to" label="Issued to" />
          </FilterBar>
          {list.rows.length === 0 ? (
            <EmptyState title="No bills" description="Add a bill for this shop." />
          ) : (
            <DataTable
              caption="Platform bills"
              columns={[
                { id: "number", header: "Bill", primary: true },
                { id: "amount", header: "Amount", align: "right" },
                { id: "issued", header: "Issued", hideOnPhone: true },
                { id: "due", header: "Due" },
                { id: "status", header: "Status" },
                { id: "act", header: "", align: "right" },
              ]}
              rows={list.rows.map((b) => ({
                id: b.id,
                cells: {
                  number: (
                    <span>
                      {b.billNumber}
                      <span className="block text-xs font-normal text-muted-foreground">{b.description}</span>
                      {b.status === "PAID" && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Paid {date(b.paidDate)}
                          {b.paidNote ? ` · ${b.paidNote}` : ""}
                        </span>
                      )}
                    </span>
                  ),
                  amount: money(b.amount),
                  issued: date(b.billDate),
                  due: date(b.dueDate),
                  status: <BillStatus bill={b} />,
                  act: (
                    <span className="flex flex-wrap justify-end gap-1">
                      {b.status === "UNPAID" ? (
                        <>
                          <PlatformBillDialog tenantId={shop.id} bill={b} />
                          <DeleteBillButton kind="PLATFORM" id={b.id} billNumber={b.billNumber} after={`/admin/shops/${shop.id}`} />
                          <MarkPaidButton kind="PLATFORM" id={b.id} billNumber={b.billNumber} amount={b.amount} />
                        </>
                      ) : (
                        <MarkUnpaidButton kind="PLATFORM" id={b.id} billNumber={b.billNumber} />
                      )}
                    </span>
                  ),
                },
              }))}
            />
          )}
          <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath={`/admin/shops/${shop.id}`} params={{ status: q.status, from: q.from, to: q.to }} />
        </Section>
      </div>
    </>
  );
}
