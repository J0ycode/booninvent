import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import products" };

export default function ImportPage() {
  return (
    <>
      <PageHeader title="Import products" description="Add many products at once from a CSV file." back={{ href: "/storeroom/products", label: "Products" }} />
      <ImportClient />
    </>
  );
}
