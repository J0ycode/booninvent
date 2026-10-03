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
import { AppError } from "@/server/errors";
import { dateTime, qtyFmt } from "@/lib/format";
import { ReceiveDispatchForm } from "./receive-form";

export const metadata: Metadata = { title: "Incoming dispatch" };

export default async function IncomingDispatchPage({ params }: PageProps<"/store/incoming/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const d = await getDispatch(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const products = await getProductsByIds(
    ctx,
    d.lines.map((l) => l.productId),
  );

  return (
    <>
      <PageHeader
        title={d.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Status value={d.status} /> {qtyFmt(d.totalPieces)} pieces · sent {dateTime(d.dispatchedAt)}
          </span>
        }
        back={{ href: "/store/incoming", label: "Incoming Dispatches" }}
        actions={
          <a href={`/api/dispatches/${d.id}/note`} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}>
            <FileText /> Dispatch note
          </a>
        }
      />
      {d.status === "DISPATCHED" ? (
        <Section title="Count what arrived">
          <p className="mb-3 text-sm text-muted-foreground">Everything is marked as received. Change a line only if pieces are missing or damaged.</p>
          <ReceiveDispatchForm
            dispatchId={d.id}
            lines={d.lines.map((l) => ({ lineId: l.id, name: products.get(l.productId)?.name ?? "Product", sku: products.get(l.productId)?.sku ?? "", quantity: l.quantity }))}
          />
        </Section>
      ) : (
        <Section>
          <DispatchLines dispatch={d} products={products} />
        </Section>
      )}
    </>
  );
}
