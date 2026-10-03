"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, SkipForward, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QtyStepper } from "@/components/app/scanner-sheet";
import { Status } from "@/components/app/status-chip";
import { ActionBar } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { qtyFmt } from "@/lib/format";
import { decideLineAction, forwardRequestAction, discardSuggestionAction } from "../actions";

export interface ReviewLine {
  id: string;
  name: string;
  sku: string;
  current: number;
  reorderLevel: number;
  quantity: number;
  lineStatus: "PENDING" | "APPROVED" | "SKIPPED";
}

/** Approve / Edit / Skip each suggested line, then Forward to Store Room. */
export function ReviewSuggestion({ requestId, lines }: { requestId: string; lines: ReviewLine[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [editQty, setEditQty] = useState(1);
  const refresh = () => router.refresh();
  const decide = useAction(decideLineAction, { onSuccess: () => (setEditing(null), refresh()) });
  const forward = useAction(forwardRequestAction, { success: "Forwarded to the Store Room", onSuccess: refresh });
  const discard = useAction(discardSuggestionAction, { success: "Suggestion discarded", onSuccess: () => router.push("/store/restock") });
  const pending = lines.filter((l) => l.lineStatus === "PENDING").length;
  const approved = lines.filter((l) => l.lineStatus === "APPROVED");
  const busy = decide.pending || forward.pending || discard.pending;

  return (
    <>
      <ul className="divide-y rounded-xl border bg-card">
        {lines.map((l) => (
          <li key={l.id} className="flex flex-col gap-3 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{l.name}</p>
                <p className="num text-xs text-muted-foreground">
                  {l.sku} · have {qtyFmt(l.current)} · reorder at {qtyFmt(l.reorderLevel)}
                </p>
              </div>
              <Status value={l.lineStatus} />
            </div>
            {editing === l.id ? (
              <div className="flex flex-wrap items-center gap-2">
                <QtyStepper value={editQty} onChange={setEditQty} id={`q-${l.id}`} />
                <Button disabled={busy} onClick={() => decide.run(requestId, { lineId: l.id, action: "APPROVE", quantity: editQty })}>
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <span className="num mr-auto text-sm">
                  Request <span className="font-semibold">{qtyFmt(l.quantity)}</span>
                </span>
                <Button size="sm" variant={l.lineStatus === "APPROVED" ? "secondary" : "outline"} disabled={busy} onClick={() => decide.run(requestId, { lineId: l.id, action: "APPROVE" })}>
                  <Check /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setEditQty(l.quantity);
                    setEditing(l.id);
                  }}
                >
                  <Pencil /> Edit
                </Button>
                <Button size="sm" variant={l.lineStatus === "SKIPPED" ? "secondary" : "outline"} disabled={busy} onClick={() => decide.run(requestId, { lineId: l.id, action: "SKIP" })}>
                  <SkipForward /> Skip
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
        {pending ? `${pending} line${pending === 1 ? "" : "s"} left to review.` : `${approved.length} approved, ${qtyFmt(approved.reduce((s, l) => s + l.quantity, 0))} pieces.`}
      </p>
      <ActionBar>
        <ConfirmDialog
          title="Discard this suggestion?"
          description="Nothing is sent to the Store Room."
          destructive
          confirmLabel="Discard"
          onConfirm={() => discard.run(requestId)}
          trigger={(open) => (
            <Button variant="outline" onClick={open} disabled={busy}>
              <Trash2 /> Discard
            </Button>
          )}
        />
        <Button disabled={busy || pending > 0 || approved.length === 0} onClick={() => forward.run(requestId)}>
          <Send /> Forward to Store Room
        </Button>
      </ActionBar>
    </>
  );
}
