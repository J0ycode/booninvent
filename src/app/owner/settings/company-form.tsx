"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormGrid, ActionBar } from "@/components/app/form-field";
import { useAction } from "@/hooks/use-action";
import type { TenantView } from "@/server/data/tenant";
import { updateCompanyAction } from "./actions";

export function CompanyForm({ tenant }: { tenant: TenantView }) {
  const router = useRouter();
  const { run, pending } = useAction(updateCompanyAction, { success: "Company details saved", onSuccess: () => router.refresh() });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(Object.fromEntries(new FormData(e.currentTarget)));
      }}
    >
      <FormGrid>
        <Field label="Shop name" htmlFor="name">
          <Input id="name" name="name" defaultValue={tenant.name} required minLength={2} />
        </Field>
        <Field label="Phone" htmlFor="phone">
          <Input id="phone" name="phone" type="tel" inputMode="tel" defaultValue={tenant.company.phone} />
        </Field>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" inputMode="email" defaultValue={tenant.company.email} />
        </Field>
        <Field label="GSTIN" htmlFor="gstin" hint="Optional">
          <Input id="gstin" name="gstin" defaultValue={tenant.company.gstin} autoCapitalize="characters" />
        </Field>
        <Field label="Address" htmlFor="address" className="md:col-span-2">
          <Textarea id="address" name="address" defaultValue={tenant.company.address} rows={3} />
        </Field>
      </FormGrid>
      <ActionBar>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </Button>
      </ActionBar>
    </form>
  );
}
