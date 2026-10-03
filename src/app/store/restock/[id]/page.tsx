import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { DataTable } from "@/components/app/data-table";
import { Status } from "@/components/app/status-chip";
import { getCtx } from "@/server/context";
import { getRequest } from "@/server/data/restock";
import { getProductsByIds } from "@/server/data/products";
import { getLevels } from "@/server/stock/read";
import { AppError } from "@/server/errors";
import { dateTime, qtyFmt } from "@/lib/format";
import { ReviewSuggestion } from "./review";

export const metadata: Metadata = { title: "Restock request" };

export default async function StoreRequestPage({ params }: PageProps<"/store/restock/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const r = await getRequest(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const ids = r.lines.map((l) => l.productId);
  const [products, levels] = await Promise.all([getProductsByIds(ctx, ids), getLevels(ctx, ids, [r.locationId])]);

  return (
    <>
      <PageHeader
        title={r.number}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Status value={r.status} /> {r.source === "SUGGESTED" ? "Suggested" : "Manual"} · {dateTime(r.sentAt ?? r.createdAt)}
          </span>
        }
        back={{ href: "/store/restock", label: "Request Restock" }}
      />
      {r.status === "WAITING_STAFF_APPROVAL" ? (
        <Section title="Review the suggestion">
          <p className="mb-3 text-sm text-muted-foreground">Only you can see this. Approve, edit or skip each line, then forward it to the Store Room.</p>
          <ReviewSuggestion
            requestId={r.id}
            lines={r.lines.map((l) => ({
              id: l.id,
              name: products.get(l.productId)?.name ?? "Product",
              sku: products.get(l.productId)?.sku ?? "",
              current: levels[l.productId]?.[r.locationId] ?? 0,
              reorderLevel: products.get(l.productId)?.reorderLevel ?? 0,
              quantity: l.quantity,
              lineStatus: l.lineStatus,
            }))}
          />
        </Section>
      ) : (
        <Section>
          {r.status === "REJECTED" && r.rejectReason && <p className="mb-3 rounded-lg bg-danger-tint p-3 text-sm text-danger-tint-foreground">Rejected: {r.rejectReason}</p>}
          {r.status === "DISPATCHED" && r.dispatchId && (
            <p className="mb-3 text-sm">
              On its way.{" "}
              <Link className="text-primary underline" href={`/store/incoming/${r.dispatchId}`}>
                Open the dispatch
              </Link>
            </p>
          )}
          <DataTable
            caption="Requested products"
            columns={[
              { id: "name", header: "Product", primary: true },
              { id: "qty", header: "Requested", align: "right" },
              { id: "line", header: "Line" },
            ]}
            rows={r.lines.map((l) => ({
              id: l.id,
              cells: { name: products.get(l.productId)?.name ?? "Product", qty: qtyFmt(l.quantity), line: <Status value={l.lineStatus} /> },
            }))}
          />
          {r.note && <p className="mt-3 text-sm text-muted-foreground">Note: {r.note}</p>}
        </Section>
      )}
    </>
  );
}
