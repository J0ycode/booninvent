"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormGrid, NativeSelect, ActionBar } from "./form-field";
import { LinesEditor, type Line } from "./lines-editor";
import { useAction } from "@/hooks/use-action";
import { createEntriesAction } from "@/app/_actions/returns";

type EntryType = "RETURN_TO_STOREROOM" | "DAMAGED" | "SUPPLIER_RETURN";

/** Store staff: return to Store Room or report damaged (needs approval). Store Room: damaged or return to supplier (applied now). */
export function ReturnsForm({ mode, locationId }: { mode: "store" | "storeroom"; locationId: string }) {
  const router = useRouter();
  const types: { value: EntryType; label: string }[] =
    mode === "store"
      ? [
          { value: "RETURN_TO_STOREROOM", label: "Return to Store Room" },
          { value: "DAMAGED", label: "Report damaged (write off)" },
        ]
      : [
          { value: "DAMAGED", label: "Damaged (write off)" },
          { value: "SUPPLIER_RETURN", label: "Return to supplier" },
        ];
  const [type, setType] = useState<EntryType>(types[0].value);
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const { run, pending } = useAction(createEntriesAction, {
    success: mode === "store" ? "Sent for approval. Stock changes once it is approved." : "Recorded. Stock updated.",
    onSuccess: () => {
      setLines([]);
      setReason("");
      router.refresh();
    },
  });
  const over = lines.some((l) => l.available !== undefined && l.quantity > l.available);

  return (
    <div className="flex flex-col gap-4">
      <FormGrid>
        <Field label="What happened?" htmlFor="rtype">
          <NativeSelect id="rtype" value={type} onChange={(e) => setType(e.target.value as EntryType)}>
            {types.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Reason" htmlFor="reason">
          <Textarea id="reason" rows={1} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stitching came apart" />
        </Field>
      </FormGrid>
      <LinesEditor lines={lines} onChange={setLines} availableAt={locationId} emptyHint="Add the products and how many pieces." />
      <ActionBar>
        <Button
          disabled={pending || !lines.length || reason.trim().length < 2 || over || lines.some((l) => !l.quantity)}
          onClick={() => run({ type, reason, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) })}
        >
          {pending ? "Saving…" : mode === "store" ? "Send for approval" : "Record"}
        </Button>
      </ActionBar>
    </div>
  );
}
