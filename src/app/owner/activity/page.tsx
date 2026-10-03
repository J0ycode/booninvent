import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Pagination } from "@/components/app/pagination";
import { FilterBar, UrlSelect, UrlDate, UrlSearch } from "@/components/app/url-filters";
import { getCtx } from "@/server/context";
import { listAuditLogs, AUDIT_AREAS, type AuditArea } from "@/server/data/audit-log";
import { listUsers } from "@/server/data/users";
import { dateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Activity Log" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

/** "dispatch.resolve_discrepancy" -> "Resolve discrepancy". The area is shown in its own column. */
function actionLabel(action: string) {
  const verb = (action.split(".").pop() ?? action).replace(/_/g, " ");
  return verb.charAt(0).toUpperCase() + verb.slice(1);
}

/** Short "key: value" summary of the saved details (plain values only). */
function details(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data as Record<string, unknown>)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v) && v !== "")
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()}: ${String(v).slice(0, 60)}`)
    .join(" · ");
}

export default async function ActivityPage({ searchParams }: PageProps<"/owner/activity">) {
  const sp = await searchParams;
  const ctx = await getCtx();
  const area = str(sp.area);
  const user = str(sp.user);
  const from = str(sp.from);
  const to = str(sp.to);
  const q = str(sp.q);
  const page = Number(str(sp.page) ?? 1) || 1;
  const [list, people] = await Promise.all([listAuditLogs(ctx, { area, userId: user, from, to, q, page }), listUsers(ctx)]);
  return (
    <>
      <PageHeader title="Activity Log" description="Every change made in your shop: who did it, what, and when. Newest first." />
      <FilterBar>
        <UrlSelect name="area" label="Area" options={[{ value: "", label: "All areas" }, ...Object.entries(AUDIT_AREAS).map(([value, label]) => ({ value, label }))]} />
        <UrlSelect
          name="user"
          label="Done by"
          options={[{ value: "", label: "Everyone" }, ...people.map((p) => ({ value: p.id, label: p.name })), { value: "api", label: "Sales API" }]}
        />
        <UrlDate name="from" label="From" />
        <UrlDate name="to" label="To" />
        <UrlSearch name="q" label="Search" placeholder="Number, name, note…" />
      </FilterBar>
      {list.rows.length === 0 ? (
        <EmptyState title="No activity" description="Nothing matches these filters." />
      ) : (
        <DataTable
          caption="Activity log"
          columns={[
            { id: "what", header: "What", primary: true },
            { id: "area", header: "Area" },
            { id: "who", header: "Done by" },
            { id: "details", header: "Details" },
            { id: "when", header: "When" },
          ]}
          rows={list.rows.map((r) => ({
            id: r.id,
            cells: {
              what: actionLabel(r.action),
              area: AUDIT_AREAS[r.entity as AuditArea] ?? r.entity,
              who: r.userId ? (r.userName ?? "Former user") : "Sales API",
              details: <span className="text-sm break-words text-muted-foreground">{details(r.data) || "—"}</span>,
              when: dateTime(r.createdAt),
            },
          }))}
        />
      )}
      <Pagination page={list.page} pageSize={list.pageSize} total={list.total} basePath="/owner/activity" params={{ area, user, from, to, q }} />
    </>
  );
}
