import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ManualRequestForm } from "./manual-form";

export const metadata: Metadata = { title: "New restock request" };

export default function NewRequestPage() {
  return (
    <>
      <PageHeader title="New restock request" back={{ href: "/store/restock", label: "Request Restock" }} />
      <ManualRequestForm />
    </>
  );
}
