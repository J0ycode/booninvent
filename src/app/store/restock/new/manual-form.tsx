"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, ActionBar } from "@/components/app/form-field";
import { LinesEditor, type Line } from "@/components/app/lines-editor";
import { Section } from "@/components/app/section";
import { useAction } from "@/hooks/use-action";
import { createManualRequestAction } from "../actions";

export function ManualRequestForm() {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const { run, pending } = useAction(createManualRequestAction, {
    success: (r) => `${r.number} sent to the Store Room`,
    onSuccess: (r) => router.push(`/store/restock/${r.id}`),
  });
  return (
    <div className="flex flex-col gap-6">
      <Section title="Products">
        <LinesEditor lines={lines} onChange={setLines} emptyHint="Search or scan the products you need." />
      </Section>
      <Section>
        <Field label="Note for the Store Room" htmlFor="note">
          <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </Field>
      </Section>
      <ActionBar>
        <Button
          disabled={pending || !lines.length || lines.some((l) => !l.quantity)}
          onClick={() => run({ note: note || undefined, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) })}
        >
          {pending ? "Sending…" : "Send request"}
        </Button>
      </ActionBar>
    </div>
  );
}
