"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { resolveDiscrepancyAction } from "../actions";

/** Return the missing/damaged pieces to Store Room stock, or write them off. */
export function ResolveButtons({ dispatchId, lineId, pieces, productName }: { dispatchId: string; lineId: string; pieces: number; productName: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { run, pending } = useAction(resolveDiscrepancyAction, { success: "Resolved", onSuccess: () => router.refresh() });
  const noteField = (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`note-${lineId}`}>Note (optional)</Label>
      <Textarea id={`note-${lineId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
    </div>
  );
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        title="Return to Store Room stock?"
        description={`${pieces} × ${productName} will be added back to the Store Room.`}
        confirmLabel="Return to stock"
        onConfirm={() => run(dispatchId, { lineId, action: "RETURN", note: note || undefined })}
        trigger={(open) => (
          <Button size="sm" variant="outline" onClick={open} disabled={pending}>
            Return to stock
          </Button>
        )}
      >
        {noteField}
      </ConfirmDialog>
      <ConfirmDialog
        title="Write off these pieces?"
        description={`${pieces} × ${productName} will be recorded as lost or damaged. Stock does not come back.`}
        confirmLabel="Write off"
        destructive
        onConfirm={() => run(dispatchId, { lineId, action: "WRITE_OFF", note: note || undefined })}
        trigger={(open) => (
          <Button size="sm" variant="destructive" onClick={open} disabled={pending}>
            Write off
          </Button>
        )}
      >
        {noteField}
      </ConfirmDialog>
    </div>
  );
}
