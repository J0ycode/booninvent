import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function Page() {
  return <PageHeader title="Dashboard" description="Your store overview." />;
}
