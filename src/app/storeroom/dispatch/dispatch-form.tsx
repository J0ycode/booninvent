"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Field, FormGrid, NativeSelect, ActionBar } from "@/components/app/form-field";
import { LinesEditor, type Line } from "@/components/app/lines-editor";
import { Section } from "@/components/app/section";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { qtyFmt } from "@/lib/format";
import { saveDraftAction, sendDispatchAction, discardDraftAction } from "./actions";

export interface DraftInit {
  id: string;
  toLocationId: string;
  note?: string;
  lines: Line[];
}

/** Create or edit a draft dispatch; for an existing draft also Send and Discard. */
export function DispatchForm({ stores, storeRoomId, draft }: { stores: { id: string; name: string }[]; storeRoomId: string; draft?: DraftInit }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>(draft?.lines ?? []);
  const [toLocationId, setTo] = useState(draft?.toLocationId ?? stores[0]?.id ?? "");
  const [note, setNote] = useState(draft?.note ?? "");
  const [dirty, setDirty] = useState(false);

  const save = useAction(saveDraftAction, {
    success: "Draft saved",
    onSuccess: (d) => {
      setDirty(false);
      if (!draft) router.push(`/storeroom/dispatch/${d.id}`);
      else router.refresh();
    },
  });
  const send = useAction(sendDispatchAction, { success: (d) => `${d.number} dispatched`, onSuccess: () => router.refresh() });
  const discard = useAction(discardDraftAction, { success: "Draft discarded", onSuccess: () => router.push("/storeroom/dispatch") });

  const payload = () => ({ toLocationId, note: note || undefined, lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })) });
  const overstock = lines.some((l) => l.available !== undefined && l.quantity > l.available);
  const invalid = !lines.length || lines.some((l) => !l.quantity);
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);
  const busy = save.pending || send.pending || discard.pending;
  const storeName = stores.find((s) => s.id === toLocationId)?.name ?? "the store";

  return (
    <div className="flex flex-col gap-6">
      <Section title="Destination">
        <FormGrid>
          <Field label="Send to" htmlFor="to">
            <NativeSelect
              id="to"
              value={toLocationId}
              onChange={(e) => {
                setTo(e.target.value);
                setDirty(true);
              }}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Note" htmlFor="note">
            <Textarea
              id="note"
              rows={1}
              value={note}
              placeholder="Optional"
              onChange={(e) => {
                setNote(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
        </FormGrid>
      </Section>
      <Section title="Products">
        <LinesEditor
          lines={lines}
          onChange={(l) => {
            setLines(l);
            setDirty(true);
          }}
          availableAt={storeRoomId}
          emptyHint="Add the products to send. Store Room stock is shown for each."
        />
        {overstock && <p className="mt-2 text-sm text-destructive">Some lines ask for more than the Store Room has. Sending will fail until you lower them.</p>}
      </Section>
      <ActionBar>
        {draft && (
          <ConfirmDialog
            title="Discard this draft?"
            description="The draft is deleted. No stock has moved."
            confirmLabel="Discard"
            destructive
            onConfirm={() => discard.run(draft.id)}
            trigger={(open) => (
              <Button variant="outline" onClick={open} disabled={busy}>
                <Trash2 /> Discard
              </Button>
            )}
          />
        )}
        <Button variant={draft ? "outline" : "default"} disabled={busy || invalid || (!!draft && !dirty)} onClick={() => save.run(draft?.id ?? null, payload())}>
          {save.pending ? "Saving…" : draft ? "Save changes" : "Save draft"}
        </Button>
        {draft && (
          <ConfirmDialog
            title={`Send to ${storeName}?`}
            description={`${qtyFmt(pieces)} pieces will be taken out of the Store Room now and shown to ${storeName} as incoming.`}
            confirmLabel="Send dispatch"
            onConfirm={() => send.run(draft.id)}
            trigger={(open) => (
              <Button onClick={open} disabled={busy || invalid || dirty || overstock} title={dirty ? "Save changes first" : undefined}>
                <Send /> Send
              </Button>
            )}
          />
        )}
      </ActionBar>
      {draft && dirty && <p className="text-right text-xs text-muted-foreground">Save your changes before sending.</p>}
    </div>
  );
}
