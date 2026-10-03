import { Download } from "lucide-react";
import { PageHeader } from "./page-header";
import { Section } from "./section";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { FilterBar, UrlSelect, UrlDate } from "./url-filters";
import { ColumnPicker } from "./column-picker";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { buildReport, REPORT_TYPES, type ReportType } from "@/server/data/reports";
import { listLocations } from "@/server/data/locations";
import { qtyFmt } from "@/lib/format";

type SP = Record<string, string | string[] | undefined>;
const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const PREVIEW = 50;

/** Reports screen shared by Owner and Store Room: pick a report, filter, preview, download CSV. */
export async function ReportsPage({ sp }: { sp: SP }) {
  const ctx = await getCtx();
  const type = (str(sp.type) && str(sp.type)! in REPORT_TYPES ? str(sp.type) : "stock") as ReportType;
  const location = str(sp.location);
  const from = str(sp.from);
  const to = str(sp.to);
  const cols = str(sp.cols);
  const [report, locations] = await Promise.all([buildReport(ctx, { type, location, from, to, cols }), listLocations(ctx)]);
  const usesDates = ["dispatches", "returns", "movements", "bills"].includes(type);
  const usesLocation = type !== "bills";
  const qs = new URLSearchParams(Object.fromEntries(Object.entries({ location, from, to, cols }).filter(([, v]) => v)) as Record<string, string>);
  // Card title on phones: the product/document name when it is shown, otherwise the first chosen column.
  const preferred = type === "low" ? report.allColumns[1]?.key : report.allColumns[0]?.key;
  const primaryKey = report.columns.some((c) => c.key === preferred) ? preferred : report.columns[0]?.key;
  const locationOptions =
    type === "dispatches"
      ? locations.filter((l) => l.type === "STORE")
      : locations;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Choose a report, filters and columns, check the preview, then download the CSV."
        actions={
          <a href={`/api/reports/${type}?${qs.toString()}`} className={buttonVariants()}>
            <Download /> Download CSV
          </a>
        }
      />
      <FilterBar>
        <UrlSelect name="type" label="Report" options={Object.entries(REPORT_TYPES).map(([value, label]) => ({ value: value === "stock" ? "" : value, label }))} />
        {usesLocation && <UrlSelect name="location" label="Location" options={[{ value: "", label: "All locations" }, ...locationOptions.map((l) => ({ value: l.id, label: l.name }))]} />}
        {usesDates && <UrlDate name="from" label="From" />}
        {usesDates && <UrlDate name="to" label="To" />}
      </FilterBar>
      {/* key: a different report has different columns, so the picker starts fresh. */}
      <ColumnPicker key={type} columns={report.allColumns.map((c) => ({ key: c.key, header: c.header }))} selected={report.columns.map((c) => c.key)} />
      <Section title={`${report.title} · ${qtyFmt(report.rows.length)} rows`}>
        {report.rows.length === 0 ? (
          <EmptyState title="No rows" description="Nothing matches these filters." />
        ) : (
          <>
            <DataTable
              caption={report.title}
              columns={report.columns.map((c) => ({ id: c.key, header: c.header, align: c.numeric ? ("right" as const) : undefined, primary: c.key === primaryKey }))}
              rows={report.rows.slice(0, PREVIEW).map((r, i) => ({ id: String(i), cells: Object.fromEntries(report.columns.map((c) => [c.key, String(r[c.key] ?? "")])) }))}
            />
            {(report.rows.length > PREVIEW || report.truncated) && (
              <p className="mt-3 text-sm text-muted-foreground">
                Showing the first {PREVIEW} rows. The CSV has all {qtyFmt(report.rows.length)}
                {report.truncated ? " (the export is limited to 5,000 rows; narrow the dates for more)" : ""}.
              </p>
            )}
          </>
        )}
      </Section>
    </>
  );
}
