import type { Metadata } from "next";
import { SupplierBillDetailPage } from "@/components/app/bills/supplier-bill-pages";

export const metadata: Metadata = { title: "Bill" };

export default async function Page({ params }: PageProps<"/owner/bills/[id]">) {
  const { id } = await params;
  return <SupplierBillDetailPage id={id} basePath="/owner/bills" />;
}
