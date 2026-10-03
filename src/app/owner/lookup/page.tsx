import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app/page-header";
import { LookupClient } from "@/components/app/lookup-client";

export const metadata: Metadata = { title: "Scan" };

export default function LookupPage() {
  return (
    <>
      <PageHeader title="Scan" />
      <Suspense>
        <LookupClient />
      </Suspense>
    </>
  );
}
