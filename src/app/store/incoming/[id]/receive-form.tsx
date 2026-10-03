"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionBar } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { cn } from "@/lib/utils";
import { receiveDispatchAction } from "../actions";

interface RLine {
  lineId: string;
  name: string;
  sku: string;
  quantity: number;
}
interface RState {
  receivedQty: number;
  missingQty: number;
  damagedQty: number;
  note: string;
}

function NumberBox({ label, value, onChange, id }: { label: string; value: number; onChange: (n: number) => void; id: string }) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        id={id}
        className="num h-11 w-20 text-right"
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(value)}
        onChange={(e) => onChange(parseInt(e.target.value.replace(/\D/g, "") || "0", 10))}
      />
    </label>
  );
}

/** Store staff confirm received pieces per line, and flag missing/damaged with a note. */
export function ReceiveDispatchForm({ dispatchId, lines }: { dispatchId: string; lines: RLine[] }) {
  const router = useRouter();
  const [state, setState] = useState<Record<string, RState>>(() =>
    Object.fromEntries(lines.map((l) => [l.lineId, { receivedQty: l.quantity, missingQty: 0, damagedQty: 0, note: "" }])),
  );
  const { run, pending } = useAction(receiveDispatchAction, {
    success: (d) => (d.status === "RECEIVED" ? "Received. Stock added to your store." : "Received with issues. The Store Room will check them."),
    onSuccess: () => router.refresh(),
  });

  const set = (id: string, patch: Partial<RState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const problems = lines.filter((l) => {
    const s = state[l.lineId];
    return s.receivedQty + s.missingQty + s.damagedQty !== l.quantity || (s.missingQty + s.damagedQty > 0 && !s.note.trim());
  });
  const issues = lines.some((l) => state[l.lineId].missingQty + state[l.lineId].damagedQty > 0);
  const good = lines.reduce((sum, l) => sum + state[l.lineId].receivedQty, 0);

  return (
    <>
      <ul className="divide-y rounded-xl border bg-card">
        {lines.map((l) => {
          const s = state[l.lineId];
          const sum = s.receivedQty + s.missingQty + s.damagedQty;
          const flagged = s.missingQty + s.damagedQty > 0;
          return (
            <li key={l.lineId} className="flex flex-col gap-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{l.name}</p>
                  <p className="num text-xs text-muted-foreground">{l.sku}</p>
                </div>
                <p className="num shrink-0 text-sm">
                  Sent <span className="font-semibold">{l.quantity}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <NumberBox id={`r-${l.lineId}`} label="Received OK" value={s.receivedQty} onChange={(n) => set(l.lineId, { receivedQty: n })} />
                <NumberBox
                  id={`m-${l.lineId}`}
                  label="Missing"
                  value={s.missingQty}
                  onChange={(n) => set(l.lineId, { missingQty: n, receivedQty: Math.max(0, l.quantity - n - s.damagedQty) })}
                />
                <NumberBox
                  id={`d-${l.lineId}`}
                  label="Damaged"
                  value={s.damagedQty}
                  onChange={(n) => set(l.lineId, { damagedQty: n, receivedQty: Math.max(0, l.quantity - n - s.missingQty) })}
                />
              </div>
              {sum !== l.quantity && <p className="text-xs font-medium text-destructive">The three numbers must add up to {l.quantity}.</p>}
              {flagged && (
                <label className="flex flex-col gap-1 text-xs text-muted-foreground" htmlFor={`n-${l.lineId}`}>
                  What happened? (required)
                  <Input id={`n-${l.lineId}`} value={s.note} onChange={(e) => set(l.lineId, { note: e.target.value })} placeholder="e.g. 2 torn, 1 not in the box" className={cn(!s.note.trim() && "border-destructive")} />
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <ActionBar>
        <ConfirmDialog
          title="Confirm this delivery?"
          description={issues ? `${good} good pieces will be added to your store. Missing and damaged pieces go to the Store Room to check.` : `${good} pieces will be added to your store.`}
          confirmLabel="Confirm receipt"
          onConfirm={() =>
            run(dispatchId, {
              lines: lines.map((l) => ({ lineId: l.lineId, ...state[l.lineId], note: state[l.lineId].note.trim() || undefined })),
            })
          }
          trigger={(open) => (
            <Button onClick={open} disabled={pending || problems.length > 0}>
              {pending ? "Saving…" : issues ? "Confirm with issues" : "Confirm all received"}
            </Button>
          )}
        />
      </ActionBar>
    </>
  );
}
