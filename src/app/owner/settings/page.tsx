import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { Section } from "@/components/app/section";
import { getCtx } from "@/server/context";
import { getMyTenant } from "@/server/data/tenant";
import { CompanyForm } from "./company-form";
import { ApiKeyPanel } from "./api-key";
import { AlertsForm } from "./alerts-form";
import { getApiKeyInfo } from "@/server/data/apikeys";
import { listLocations } from "@/server/data/locations";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await getCtx();
  const [tenant, keyInfo, locations] = await Promise.all([getMyTenant(ctx), getApiKeyInfo(ctx), listLocations(ctx)]);
  return (
    <>
      <PageHeader title="Settings" description="Company details shown on dispatch notes, email alerts, and the sales API key." />
      <div className="flex flex-col gap-6">
        <Section title="Company details">
          <CompanyForm tenant={tenant} />
        </Section>
        <Section title="Email alerts">
          <AlertsForm enabled={tenant.lowStockEmail} />
        </Section>
        <Section title="Sales API key">
          <ApiKeyPanel info={keyInfo} stores={locations.filter((l) => l.type === "STORE").map((l) => ({ id: l.id, name: l.name }))} />
        </Section>
      </div>
    </>
  );
}
