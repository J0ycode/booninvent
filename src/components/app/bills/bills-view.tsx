import Link from "next/link";
import { Download } from "lucide-react";
import { DataTable } from "../data-table";
import { EmptyState } from "../empty-state";
import { Pagination } from "../pagination";
import { StatCard, StatGrid } from "../stat-card";
import { Status, StatusChip } from "../status-chip";
import { FilterBar, UrlSelect, UrlDate } from "../url-filters";
import { MarkPaidButton } from "./bill-actions";
import { buttonVariants } from "@/components/ui/button";
import { date, money } from "@/lib/format";
import type { BillView, BillTotals } from "@/server/data/bills";

export const BILL_STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "unpaid", label: "Unpaid" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
];

export function BillStatus({ bill }: { bill: Pick<BillView, "status" | "overdue"> }) {
  return (
    <span className="flex flex-wrap gap-1">
      <Status value={bill.status} />
      {bill.overdue && <StatusChip tone="danger">Overdue</StatusChip>}
    </span>
  );
}

export function BillTotalsCards({ totals }: { totals: BillTotals }) {
  return (
    <StatGrid>
      <StatCard label="Unpaid" value={money(totals.unpaidAmount)} hint={`${totals.unpaidCount} bill${totals.unpaidCount === 1 ? "" : "s"}`} />
      <StatCard
        label="Overdue"
        value={money(totals.overdueAmount)}
        hint={`${totals.overdueCount} bill${totals.overdueCount === 1 ? "" : "s"}`}
        tone={totals.overdueCount ? "danger" : undefined}
      />
    </StatGrid>
  );
}

/** Filters + totals + list + CSV link, for supplier bills, platform bills (owner, read-only) and admin. */
export function BillsView({
  list,
  basePath,
  params,
  partyLabel,
  partyOptions,
  partyParam,
  partyName,
  exportHref,
  markPaid,
  linkRows = true,
}: {
  list: { rows: BillView[]; total: number; page: number; pageSize: number; totals: BillTotals };
  basePath: string;
  params: Record<string, string | undefined>;
  partyLabel?: string;
  partyOptions?: { value: string; label: string }[];
  partyParam?: string;
  partyName?: (b: BillView) => string;
  exportHref: string;
  markPaid?: "SUPPLIER" | "PLATFORM";
  linkRows?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <BillTotalsCards totals={list.totals} />
      <FilterBar>
        <UrlSelect name="status" label="Status" options={BILL_STATUS_OPTIONS} />
        {partyOptions && partyParam && <UrlSelect name={partyParam} label={partyLabel ?? "Party"} options={[{ value: "", label: "All" }, ...partyOptions]} />}
        <UrlDate name="from" label="Bill date from" />
        <UrlDate name="to" label="Bill date to" />
      </FilterBar>
      <div className="flex justify-end">
        <a href={exportHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Download /> Export CSV
        </a>
      </div>
      {list.rows.length === 0 ? (
        <EmptyState title="No bills" description="No bills match these filters." />
      ) : (
        <DataTable
          caption="Bills"
          columns={[
            { id: "number", header: "Bill", primary: true },
            ...(partyName ? [{ id: "party", header: partyLabel ?? "Party" }] : []),
            { id: "amount", header: "Amount", align: "right" as const },
            { id: "due", header: "Due" },
            { id: "status", header: "Status" },
            ...(markPaid ? [{ id: "act", header: "", align: "right" as const }] : []),
          ]}
          rows={list.rows.map((b) => ({
            id: b.id,
            href: linkRows ? `${basePath}/${b.id}` : undefined,
            cells: {
              number: (
                <span>
                  {b.billNumber}
                  {b.description && <span className="block text-xs font-normal text-muted-foreground">{b.description}</span>}
                </span>
              ),
              party: partyName?.(b) ?? "—",
              amount: money(b.amount),
              due: date(b.dueDate),
              status: <BillStatus bill={b} />,
              act: markPaid && b.status === "UNPAID" ? <MarkPaidButton kind={markPaid} id={b.id} billNumber={b.billNumber} amount={b.amount} /> : null,
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath={basePath} params={params} />
    </div>
  );
}

export function BillDetailList({ bill, extra }: { bill: BillView; extra?: [string, React.ReactNode][] }) {
  const rows: [string, React.ReactNode][] = [
    ["Amount", <span key="a" className="num font-semibold">{money(bill.amount)}</span>],
    ["Status", <BillStatus key="s" bill={bill} />],
    [bill.kind === "SUPPLIER" ? "Bill date" : "Issue date", date(bill.billDate)],
    ["Due date", date(bill.dueDate)],
    ...(extra ?? []),
    ...(bill.status === "PAID" ? ([["Paid on", date(bill.paidDate)], ["Payment note", bill.paidNote ?? "—"]] as [string, React.ReactNode][]) : []),
    ...(bill.note ? ([["Note", bill.note]] as [string, React.ReactNode][]) : []),
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="mt-0.5">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function receiptLink(href: string, label: string) {
  return (
    <Link href={href} className="text-primary underline">
      {label}
    </Link>
  );
}
