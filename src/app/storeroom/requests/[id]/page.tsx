import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { Status } from "@/components/app/status-chip";
import { getCtx } from "@/server/context";
import { getRequest } from "@/server/data/restock";
import { getProductsByIds } from "@/server/data/products";
import { listLocations } from "@/server/data/locations";
import { getLevels } from "@/server/stock/read";
import { AppError } from "@/server/errors";
import { dateTime, qtyFmt } from "@/lib/format";
import { DecideRequest } from "./decide";

export const metadata: Metadata = { title: "Restock request" };

export default async function StoreroomRequestPage({ params }: PageProps<"/storeroom/requests/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const r = await getRequest(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const locations = await listLocations(ctx);
  const storeRoom = locations.find((l) => l.type === "STORE_ROOM")!;
  const ids = r.lines.map((l) => l.productId);
  const [products, levels] = await Promise.all([getProductsByIds(ctx, ids), getLevels(ctx, ids, [r.locationId, storeRoom.id])]);
  const storeName = locations.find((l) => l.id === r.locationId)?.name ?? "Store";
  const lines = r.lines.filter((l) => l.lineStatus === "APPROVED");

  return (
    <>
      <PageHeader
        title={`${r.number} · ${storeName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Status value={r.status} /> {r.source === "SUGGESTED" ? "Suggested" : "Manual"} · sent {dateTime(r.sentAt)}
          </span>
        }
        back={{ href: "/storeroom/requests", label: "Restock Requests" }}
      />
      <Section>
        {r.note && <p className="mb-3 text-sm">Note from store: {r.note}</p>}
        {r.status === "REJECTED" && <p className="mb-3 text-sm text-destructive">Rejected: {r.rejectReason}</p>}
        {r.dispatchId && (
          <p className="mb-3 text-sm">
            <Link className="text-primary underline" href={`/storeroom/dispatch/${r.dispatchId}`}>
              Open the dispatch
            </Link>
          </p>
        )}
        <DataTable
          caption="Requested products"
          columns={[
            { id: "name", header: "Product", primary: true },
            { id: "qty", header: "Requested", align: "right" },
            { id: "store", header: `At ${storeName}`, align: "right" },
            { id: "sr", header: "In Store Room", align: "right" },
          ]}
          rows={lines.map((l) => {
            const sr = levels[l.productId]?.[storeRoom.id] ?? 0;
            return {
              id: l.id,
              cells: {
                name: products.get(l.productId)?.name ?? "Product",
                qty: qtyFmt(l.quantity),
                store: qtyFmt(levels[l.productId]?.[r.locationId] ?? 0),
                sr: <span className={sr < l.quantity ? "font-semibold text-destructive" : undefined}>{qtyFmt(sr)}</span>,
              },
            };
          })}
        />
        {r.status === "SENT" && <DecideRequest id={r.id} number={r.number} />}
      </Section>
    </>
  );
}
