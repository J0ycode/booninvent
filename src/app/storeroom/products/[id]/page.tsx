import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { Barcode } from "@/components/app/barcode";
import { getCtx } from "@/server/context";
import { getProduct } from "@/server/data/products";
import { listSuppliers } from "@/server/data/suppliers";
import { listLocations } from "@/server/data/locations";
import { getLevels } from "@/server/stock/read";
import { AppError } from "@/server/errors";
import { qtyFmt } from "@/lib/format";
import { ProductForm } from "../product-form";

export const metadata: Metadata = { title: "Product" };

export default async function ProductPage({ params }: PageProps<"/storeroom/products/[id]">) {
  const { id } = await params;
  const ctx = await getCtx();
  const product = await getProduct(ctx, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [suppliers, locations, levels] = await Promise.all([listSuppliers(ctx), listLocations(ctx), getLevels(ctx, [id])]);

  return (
    <>
      <PageHeader title={product.name} description={`${product.sku} · ${product.barcode}`} back={{ href: "/storeroom/products", label: "Products" }} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Section title="Details">
          <ProductForm product={product} suppliers={suppliers} />
        </Section>
        <div className="flex flex-col gap-6">
          <Section title="Barcode">
            <Barcode value={product.barcode} />
          </Section>
          <Section title="Stock">
            <ul className="divide-y text-sm">
              {locations.map((l) => (
                <li key={l.id} className="flex justify-between py-2">
                  <span>{l.name}</span>
                  <span className="num font-semibold">{qtyFmt(levels[id]?.[l.id] ?? 0)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
