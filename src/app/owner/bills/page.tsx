import type { Metadata } from "next";
import { SupplierBillsPage } from "@/components/app/bills/supplier-bill-pages";

export const metadata: Metadata = { title: "Bills" };

export default async function Page({ searchParams }: PageProps<"/owner/bills">) {
  return <SupplierBillsPage sp={await searchParams} basePath="/owner/bills" />;
}
