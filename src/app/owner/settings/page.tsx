import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { getCtx } from "@/server/context";
import { getMyTenant } from "@/server/data/tenant";
import { CompanyForm } from "./company-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getCtx();
  const tenant = await getMyTenant(ctx);
  return (
    <>
      <PageHeader title="Settings" description="Company details shown on dispatch notes, and the sales API key." />
      <div className="flex flex-col gap-6">
        <Section title="Company details">
          <CompanyForm tenant={tenant} />
        </Section>
      </div>
    </>
  );
}
