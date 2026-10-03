import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { Status } from "@/components/app/status-chip";
import { DispatchLines } from "@/components/app/dispatch-lines";
import { buttonVariants } from "@/components/ui/button";
import { getCtx } from "@/server/context";
import { getDispatch } from "@/server/stock/dispatches";
import { getProductsByIds } from "@/server/data/products";
import { listLocations } from "@/server/data/locations";
import { getLevels } from "@/server/stock/read";
import { AppError } from "@/server/errors";
import { dateTime, qtyFmt } from "@/lib/format";
import { DispatchForm } from "../dispatch-form";
import { ResolveButtons } from "./resolve-buttons";

export const metadata: Metadata = { title: "Dispatch" };

export default async function DispatchPage({ params }: PageProps<"/storeroom/dispatch/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const d = await getDispatch(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const ids = d.lines.map((l) => l.productId);
  const [products, locations, levels] = await Promise.all([getProductsByIds(ctx, ids), listLocations(ctx), getLevels(ctx, ids, [d.fromLocationId])]);
  const locName = (lid: string) => locations.find((l) => l.id === lid)?.name ?? "";
  const back = { href: "/storeroom/dispatch", label: "Dispatch" };

  if (d.status === "DRAFT") {
    return (
      <>
        <PageHeader title={`${d.number} (draft)`} description="Edit, then press Send. Stock moves only when sent." back={back} />
        <DispatchForm
          stores={locations.filter((l) => l.type === "STORE").map((s) => ({ id: s.id, name: s.name }))}
          storeRoomId={d.fromLocationId}
          draft={{
            id: d.id,
            toLocationId: d.toLocationId,
            note: d.note,
            lines: d.lines.map((l) => {
              const p = products.get(l.productId);
              return {
                productId: l.productId,
                name: p?.name ?? "Product",
                sku: p?.sku ?? "",
                barcode: p?.barcode ?? "",
                quantity: l.quantity,
                available: levels[l.productId]?.[d.fromLocationId] ?? 0,
              };
            }),
          }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={d.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Status value={d.status} /> {locName(d.fromLocationId)} → {locName(d.toLocationId)} · {qtyFmt(d.totalPieces)} pieces
          </span>
        }
        back={back}
        actions={
          <a href={`/api/dispatches/${d.id}/note`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
            <FileText /> Dispatch note (PDF)
          </a>
        }
      />
      <Section>
        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Sent</dt>
            <dd>{dateTime(d.dispatchedAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Received</dt>
            <dd>{dateTime(d.receivedAt)}</dd>
          </div>
          {d.note && (
            <div className="col-span-2 sm:col-span-1">
              <dt className="text-xs text-muted-foreground">Note</dt>
              <dd>{d.note}</dd>
            </div>
          )}
        </dl>
        <DispatchLines
          dispatch={d}
          products={products}
          actions={
            d.status === "RECEIVED_WITH_ISSUES"
              ? (lineId) => {
                  const l = d.lines.find((x) => x.id === lineId)!;
                  return <ResolveButtons dispatchId={d.id} lineId={lineId} pieces={l.missingQty + l.damagedQty} productName={products.get(l.productId)?.name ?? "product"} />;
                }
              : undefined
          }
        />
      </Section>
    </>
  );
}
