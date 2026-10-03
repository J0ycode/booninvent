"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Undo2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "../confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { isoDay, money } from "@/lib/format";
import {
  markSupplierPaidAction,
  markSupplierUnpaidAction,
  deleteSupplierBillAction,
  markPlatformPaidAction,
  markPlatformUnpaidAction,
  deletePlatformBillAction,
} from "@/app/_actions/bills";

type Kind = "SUPPLIER" | "PLATFORM";
const ACTIONS = {
  SUPPLIER: { paid: markSupplierPaidAction, unpaid: markSupplierUnpaidAction, del: deleteSupplierBillAction },
  PLATFORM: { paid: markPlatformPaidAction, unpaid: markPlatformUnpaidAction, del: deletePlatformBillAction },
};

/** One-click "Mark paid" with a small confirm (paid date + optional note). */
export function MarkPaidButton({ kind, id, billNumber, amount, size = "sm" }: { kind: Kind; id: string; billNumber: string; amount: number; size?: "sm" | "default" }) {
  const router = useRouter();
  const [paidDate, setPaidDate] = useState(isoDay());
  const [note, setNote] = useState("");
  const { run, pending } = useAction(ACTIONS[kind].paid, { success: `${billNumber} marked paid`, onSuccess: () => router.refresh() });
  return (
    <ConfirmDialog
      title={`Mark ${billNumber} as paid?`}
      description={`${money(amount)}. This only records the payment; no money moves through the app.`}
      confirmLabel="Mark paid"
      onConfirm={() => run(id, { paidDate, note: note || undefined })}
      trigger={(open) => (
        <Button size={size} onClick={open} disabled={pending}>
          <Check /> Mark paid
        </Button>
      )}
    >
      <div className="grid gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pd-${id}`}>Paid on</Label>
          <Input id={`pd-${id}`} type="date" value={paidDate} max={isoDay()} onChange={(e) => setPaidDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`pn-${id}`}>Note (optional)</Label>
          <Input id={`pn-${id}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Paid by UPI" />
        </div>
      </div>
    </ConfirmDialog>
  );
}

export function MarkUnpaidButton({ kind, id, billNumber }: { kind: Kind; id: string; billNumber: string }) {
  const router = useRouter();
  const { run, pending } = useAction(ACTIONS[kind].unpaid, { success: `${billNumber} marked unpaid`, onSuccess: () => router.refresh() });
  return (
    <ConfirmDialog
      title={`Mark ${billNumber} as unpaid?`}
      description="The paid date and note are cleared. The bill can be edited again."
      confirmLabel="Mark unpaid"
      onConfirm={() => run(id)}
      trigger={(open) => (
        <Button size="sm" variant="outline" onClick={open} disabled={pending}>
          <Undo2 /> Mark unpaid
        </Button>
      )}
    />
  );
}

export function DeleteBillButton({ kind, id, billNumber, after }: { kind: Kind; id: string; billNumber: string; after: string }) {
  const router = useRouter();
  const { run, pending } = useAction(ACTIONS[kind].del, { success: "Bill deleted", onSuccess: () => router.push(after) });
  return (
    <ConfirmDialog
      title={`Delete ${billNumber}?`}
      description="This cannot be undone."
      confirmLabel="Delete"
      destructive
      onConfirm={() => run(id)}
      trigger={(open) => (
        <Button variant="destructive" onClick={open} disabled={pending}>
          <Trash2 /> Delete
        </Button>
      )}
    />
  );
}
