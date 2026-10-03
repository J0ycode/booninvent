import type { Metadata } from "next";
import { ReportsPage } from "@/components/app/reports-page";

export const metadata: Metadata = { title: "Reports" };

export default async function Page({ searchParams }: PageProps<"/owner/reports">) {
  return <ReportsPage sp={await searchParams} />;
}
