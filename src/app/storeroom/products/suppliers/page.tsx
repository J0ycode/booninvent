import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/server/context";
import { listSuppliers } from "@/server/data/suppliers";
import { SuppliersClient } from "./suppliers-client";

export const metadata: Metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const suppliers = await listSuppliers(await getCtx());
  return (
    <>
      <PageHeader title="Suppliers" back={{ href: "/storeroom/products", label: "Products" }} />
      <SuppliersClient suppliers={suppliers} />
    </>
  );
}
