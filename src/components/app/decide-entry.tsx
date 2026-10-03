"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "./confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { approveEntryAction, rejectEntryAction } from "@/app/_actions/returns";

/** Approve / reject a pending return or damage entry. */
export function DecideEntry({ id, summary }: { id: string; summary: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const approve = useAction(approveEntryAction, { success: "Approved. Stock updated.", onSuccess: () => router.refresh() });
  const reject = useAction(rejectEntryAction, { success: "Rejected", onSuccess: () => router.refresh() });
  const busy = approve.pending || reject.pending;
  return (
    <span className="flex flex-wrap justify-end gap-2">
      <ConfirmDialog
        title="Reject this entry?"
        description={summary}
        destructive
        confirmLabel="Reject"
        onConfirm={() => reject.run(id, { note })}
        trigger={(open) => (
          <Button size="sm" variant="outline" onClick={open} disabled={busy}>
            Reject
          </Button>
        )}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`rn-${id}`}>Reason</Label>
          <Textarea id={`rn-${id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        title="Approve this entry?"
        description={`${summary} Stock changes now.`}
        confirmLabel="Approve"
        onConfirm={() => approve.run(id)}
        trigger={(open) => (
          <Button size="sm" onClick={open} disabled={busy}>
            Approve
          </Button>
        )}
      />
    </span>
  );
}
