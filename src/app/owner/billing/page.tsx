import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { BillsView } from "@/components/app/bills/bills-view";
import { getCtx } from "@/server/context";
import { listMyPlatformBills, type BillStatusFilter } from "@/server/data/bills";

export const metadata: Metadata = { title: "Billing" };

const str = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

/** Platform bills issued to this shop. Read-only for the owner. */
export default async function BillingPage({ searchParams }: PageProps<"/owner/billing">) {
  const sp = await searchParams;
  const q = { status: str(sp.status) as BillStatusFilter | undefined, from: str(sp.from), to: str(sp.to), page: Number(str(sp.page) ?? 1) || 1 };
  const list = await listMyPlatformBills(await getCtx(), q);
  const params = { status: q.status, from: q.from, to: q.to };
  const exportQ = new URLSearchParams({ kind: "platform", ...(Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>) });
  return (
    <>
      <PageHeader title="Billing" description="Bills from BoonBaby for using this app. To pay, follow the instructions on the bill; the status is updated by our team." />
      <BillsView list={list} basePath="/owner/billing" params={params} exportHref={`/api/bills/export?${exportQ.toString()}`} linkRows={false} />
    </>
  );
}
