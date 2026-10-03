"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/app/form-field";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { isoDay, paiseToInput } from "@/lib/format";
import type { BillView } from "@/server/data/bills";
import { savePlatformBillAction, setShopStatusAction } from "@/app/_actions/bills";

export function ShopStatusButton({ tenantId, status, name }: { tenantId: string; status: "ACTIVE" | "SUSPENDED"; name: string }) {
  const router = useRouter();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const { run, pending } = useAction(setShopStatusAction, { success: next === "SUSPENDED" ? "Shop suspended" : "Shop activated", onSuccess: () => router.refresh() });
  return (
    <ConfirmDialog
      title={next === "SUSPENDED" ? `Suspend ${name}?` : `Activate ${name}?`}
      description={
        next === "SUSPENDED"
          ? "People can still sign in and view data, but every change (stock, products, bills) is blocked until you activate the shop."
          : "The shop can make changes again."
      }
      destructive={next === "SUSPENDED"}
      confirmLabel={next === "SUSPENDED" ? "Suspend" : "Activate"}
      onConfirm={() => run(tenantId, next)}
      trigger={(open) => (
        <Button variant={next === "SUSPENDED" ? "destructive" : "default"} onClick={open} disabled={pending}>
          {next === "SUSPENDED" ? "Suspend shop" : "Activate shop"}
        </Button>
      )}
    />
  );
}

export function PlatformBillDialog({ tenantId, bill }: { tenantId: string; bill?: BillView }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [defaultDue] = useState(() => isoDay(new Date(Date.now() + 15 * 864e5)));
  const { run, pending } = useAction(savePlatformBillAction, {
    success: bill ? "Bill saved" : "Bill added",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  return (
    <>
      {bill ? (
        <Button size="icon-sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${bill.billNumber}`}>
          <Pencil />
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus /> Add bill
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{bill ? `Edit ${bill.billNumber}` : "Add platform bill"}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              run(tenantId, bill?.id ?? null, Object.fromEntries(new FormData(e.currentTarget)));
            }}
          >
            <Field label="Bill number" htmlFor="pb-no" error={errors.billNumber}>
              <Input id="pb-no" name="billNumber" defaultValue={bill?.billNumber} required />
            </Field>
            <Field label="Description" htmlFor="pb-desc" error={errors.description}>
              <Input id="pb-desc" name="description" defaultValue={bill?.description} placeholder="e.g. Subscription, October 2026" required />
            </Field>
            <Field label="Amount (₹)" htmlFor="pb-amt" error={errors.amount}>
              <Input id="pb-amt" name="amount" inputMode="decimal" className="num" defaultValue={paiseToInput(bill?.amount)} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Issue date" htmlFor="pb-issue" error={errors.issueDate}>
                <Input id="pb-issue" name="issueDate" type="date" defaultValue={bill ? isoDay(new Date(bill.billDate)) : isoDay()} required />
              </Field>
              <Field label="Due date" htmlFor="pb-due" error={errors.dueDate}>
                <Input id="pb-due" name="dueDate" type="date" defaultValue={bill ? isoDay(new Date(bill.dueDate)) : defaultDue} required />
              </Field>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
