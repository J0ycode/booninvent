import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Shops" };

export default function Page() {
  return <PageHeader title="Shops" description="Platform shops will appear here." />;
}
