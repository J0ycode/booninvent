import { DataTable } from "./data-table";
import { Status } from "./status-chip";
import { DecideEntry } from "./decide-entry";
import { dateTime, qtyFmt } from "@/lib/format";
import { TYPE_LABEL, type ReturnEntryView } from "@/server/stock/returns";
import type { ProductView } from "@/server/data/products";

/** Returns / damaged entries. With `decide`, pending rows get Approve / Reject. */
export function EntriesTable({
  entries,
  products,
  locName,
  decide,
  caption,
}: {
  entries: ReturnEntryView[];
  products: Map<string, ProductView>;
  locName?: Map<string, string>;
  decide?: boolean;
  caption: string;
}) {
  return (
    <DataTable
      caption={caption}
      columns={[
        { id: "product", header: "Product", primary: true },
        { id: "type", header: "Type" },
        ...(locName ? [{ id: "loc", header: "Location" }] : []),
        { id: "qty", header: "Pieces", align: "right" as const },
        { id: "reason", header: "Reason", hideOnPhone: !decide },
        { id: "status", header: "Status" },
        { id: "date", header: "Date", hideOnPhone: true },
        ...(decide ? [{ id: "act", header: "", align: "right" as const }] : []),
      ]}
      rows={entries.map((e) => {
        const name = products.get(e.productId)?.name ?? "Product";
        return {
          id: e.id,
          cells: {
            product: name,
            type: TYPE_LABEL[e.type],
            loc: locName?.get(e.locationId) ?? "—",
            qty: qtyFmt(e.quantity),
            reason: (
              <span>
                {e.reason}
                {e.decisionNote && e.status === "REJECTED" && <span className="block text-xs text-destructive">Rejected: {e.decisionNote}</span>}
              </span>
            ),
            status: <Status value={e.status} />,
            date: dateTime(e.createdAt),
            act: decide && e.status === "PENDING" ? <DecideEntry id={e.id} summary={`${TYPE_LABEL[e.type]}: ${e.quantity} × ${name}.`} /> : null,
          },
        };
      })}
    />
  );
}
