import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { getCtx } from "@/server/context";
import { listSuppliers } from "@/server/data/suppliers";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const suppliers = await listSuppliers(await getCtx(), { activeOnly: true });
  return (
    <>
      <PageHeader title="Add product" back={{ href: "/storeroom/products", label: "Products" }} />
      <Section>
        <ProductForm suppliers={suppliers} />
      </Section>
    </>
  );
}
