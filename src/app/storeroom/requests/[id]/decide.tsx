"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ActionBar } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { approveRequestAction, rejectRequestAction } from "../actions";

export function DecideRequest({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const approve = useAction(approveRequestAction, {
    success: "Approved. A draft dispatch is ready.",
    onSuccess: (r) => router.push(`/storeroom/dispatch/${r.dispatchId}`),
  });
  const reject = useAction(rejectRequestAction, { success: "Request rejected", onSuccess: () => router.refresh() });
  const busy = approve.pending || reject.pending;
  return (
    <ActionBar>
      <ConfirmDialog
        title={`Reject ${number}?`}
        description="The store sees the reason."
        destructive
        confirmLabel="Reject"
        onConfirm={async () => {
          await reject.run(id, { reason });
        }}
        trigger={(open) => (
          <Button variant="outline" onClick={open} disabled={busy}>
            <X /> Reject
          </Button>
        )}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reason">Reason</Label>
          <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of stock until next week" />
        </div>
      </ConfirmDialog>
      <Button onClick={() => approve.run(id)} disabled={busy}>
        <Check /> {approve.pending ? "Creating dispatch…" : "Approve and create dispatch"}
      </Button>
    </ActionBar>
  );
}
