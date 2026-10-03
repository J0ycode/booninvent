import type { ReactNode } from "react";
import { DataTable } from "./data-table";
import { StatusChip } from "./status-chip";
import { qtyFmt } from "@/lib/format";
import type { DispatchView } from "@/server/stock/dispatches";
import type { ProductView } from "@/server/data/products";

/** Read-only dispatch lines with received / missing / damaged, used by Store Room and Store screens. */
export function DispatchLines({ dispatch, products, actions }: { dispatch: DispatchView; products: Map<string, ProductView>; actions?: (lineId: string) => ReactNode }) {
  const received = dispatch.status !== "DRAFT" && dispatch.status !== "DISPATCHED";
  return (
    <DataTable
      caption="Dispatch lines"
      columns={[
        { id: "name", header: "Product", primary: true },
        { id: "sku", header: "SKU", hideOnPhone: true },
        { id: "sent", header: "Sent", align: "right" },
        ...(received
          ? [
              { id: "received", header: "Received", align: "right" as const },
              { id: "issue", header: "Missing / damaged" },
            ]
          : []),
      ]}
      rows={dispatch.lines.map((l) => {
        const p = products.get(l.productId);
        const issue = l.missingQty + l.damagedQty;
        return {
          id: l.id,
          cells: {
            name: p?.name ?? "Product",
            sku: <span className="num">{p?.sku}</span>,
            sent: qtyFmt(l.quantity),
            received: qtyFmt(l.receivedQty),
            issue:
              issue > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    {l.missingQty > 0 && <StatusChip tone="peach">{l.missingQty} missing</StatusChip>}
                    {l.damagedQty > 0 && <StatusChip tone="danger">{l.damagedQty} damaged</StatusChip>}
                    {l.resolution && <StatusChip tone="mint">{l.resolution.action === "RETURN" ? "Returned to stock" : "Written off"}</StatusChip>}
                  </span>
                  {l.note && <span className="text-xs text-muted-foreground">“{l.note}”</span>}
                  {!l.resolution && actions?.(l.id)}
                </div>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
          },
        };
      })}
    />
  );
}
