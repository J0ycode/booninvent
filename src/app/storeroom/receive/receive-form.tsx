"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormGrid, NativeSelect, ActionBar } from "@/components/app/form-field";
import { LinesEditor, rupeesToPaiseClient, type Line } from "@/components/app/lines-editor";
import { Section } from "@/components/app/section";
import { useAction } from "@/hooks/use-action";
import type { SupplierView } from "@/server/data/suppliers";
import { receiveStockAction } from "./actions";

export function ReceiveForm({ suppliers }: { suppliers: SupplierView[] }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run, pending } = useAction(receiveStockAction, {
    success: (r) => `${r.number} saved. Stock added to the Store Room.`,
    onSuccess: (r) => router.push(`/storeroom/receive/${r.id}`),
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErrors({});
    if (lines.some((l) => !l.quantity)) return setErrors({ lines: "Every line needs a quantity of at least 1." });
    run({
      supplierId: fd.get("supplierId"),
      invoiceNumber: fd.get("invoiceNumber"),
      note: fd.get("note") || undefined,
      lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, cost: rupeesToPaiseClient(l.cost) })),
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      <Section title="Supplier invoice">
        <FormGrid>
          <Field label="Supplier" htmlFor="supplierId" error={errors.supplierId}>
            <NativeSelect id="supplierId" name="supplierId" required defaultValue="">
              <option value="" disabled>
                Choose supplier
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Invoice number" htmlFor="invoiceNumber" error={errors.invoiceNumber}>
            <Input id="invoiceNumber" name="invoiceNumber" required autoComplete="off" />
          </Field>
          <Field label="Note" htmlFor="note" className="md:col-span-2">
            <Textarea id="note" name="note" rows={2} placeholder="Optional" />
          </Field>
        </FormGrid>
      </Section>
      <Section title="Products received">
        <LinesEditor lines={lines} onChange={setLines} showCost emptyHint="Search, scan, or use a USB scanner to add the products on this invoice." />
        {(errors.lines || errors["lines"]) && <p className="mt-2 text-sm text-destructive">{errors.lines}</p>}
      </Section>
      <ActionBar>
        <Button type="submit" disabled={pending || !lines.length}>
          {pending ? "Saving…" : "Receive stock"}
        </Button>
      </ActionBar>
    </form>
  );
}
