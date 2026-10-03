import { dateTime } from "@/lib/format";
import type { ActivityRow } from "@/server/data/dashboard";

export const MOVEMENT_LABEL: Record<string, string> = {
  RECEIPT: "Received from supplier",
  DISPATCH_OUT: "Sent to store",
  DISPATCH_IN: "Received from Store Room",
  SALE: "Sold",
  RETURN_OUT: "Returned to Store Room",
  RETURN_IN: "Returned in",
  DAMAGE: "Written off",
  SUPPLIER_RETURN: "Returned to supplier",
  ADJUSTMENT: "Adjustment",
};

export function ActivityList({ rows, showLocation = true }: { rows: ActivityRow[]; showLocation?: boolean }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No stock activity yet.</p>;
  return (
    <ul className="divide-y text-sm">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.productName}</p>
            <p className="text-xs text-muted-foreground">
              {MOVEMENT_LABEL[r.type] ?? r.type}
              {showLocation && ` · ${r.locationName}`} · {dateTime(r.createdAt)}
            </p>
          </div>
          <span className={`num shrink-0 font-semibold ${r.quantityDelta < 0 ? "text-destructive" : "text-mint-foreground"}`}>
            {r.quantityDelta > 0 ? "+" : ""}
            {r.quantityDelta}
          </span>
        </li>
      ))}
    </ul>
  );
}
