"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Field, NativeSelect } from "../form-field";
import { useAction } from "@/hooks/use-action";
import { isoDay, paiseToInput } from "@/lib/format";
import type { BillView } from "@/server/data/bills";
import { saveSupplierBillAction } from "@/app/_actions/bills";

export function SupplierBillDialog({
  suppliers,
  receipts,
  bill,
  basePath,
}: {
  suppliers: { id: string; name: string }[];
  receipts: { id: string; label: string; supplierId: string }[];
  bill?: BillView;
  basePath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [defaultDue] = useState(() => isoDay(new Date(Date.now() + 30 * 864e5)));
  const [supplierId, setSupplierId] = useState(bill?.supplierId ?? suppliers[0]?.id ?? "");
  const { run, pending } = useAction(saveSupplierBillAction, {
    success: bill ? "Bill saved" : "Bill added",
    onSuccess: (b) => {
      setOpen(false);
      if (bill) router.refresh();
      else router.push(`${basePath}/${b.id}`);
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });

  return (
    <>
      {bill ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          <Pencil /> Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)} disabled={!suppliers.length} title={suppliers.length ? undefined : "Add a supplier first"}>
          <Plus /> Add bill
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{bill ? `Edit ${bill.billNumber}` : "Add supplier bill"}</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              setErrors({});
              const fd = new FormData(e.currentTarget);
              run(bill?.id ?? null, Object.fromEntries(fd));
            }}
          >
            <Field label="Supplier" htmlFor="b-sup" error={errors.supplierId}>
              <NativeSelect id="b-sup" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Bill number" htmlFor="b-no" error={errors.billNumber}>
              <Input id="b-no" name="billNumber" defaultValue={bill?.billNumber} required />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bill date" htmlFor="b-date" error={errors.billDate}>
                <Input id="b-date" name="billDate" type="date" defaultValue={bill ? isoDay(new Date(bill.billDate)) : isoDay()} required />
              </Field>
              <Field label="Due date" htmlFor="b-due" error={errors.dueDate}>
                <Input id="b-due" name="dueDate" type="date" defaultValue={bill ? isoDay(new Date(bill.dueDate)) : defaultDue} required />
              </Field>
            </div>
            <Field label="Amount (₹)" htmlFor="b-amt" error={errors.amount}>
              <Input id="b-amt" name="amount" inputMode="decimal" className="num" defaultValue={paiseToInput(bill?.amount)} required />
            </Field>
            <Field label="Linked stock receipt" htmlFor="b-rcpt" hint="Optional">
              <NativeSelect id="b-rcpt" name="receiptId" defaultValue={bill?.receiptId ?? ""}>
                <option value="">None</option>
                {receipts
                  .filter((r) => r.supplierId === supplierId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
              </NativeSelect>
            </Field>
            <Field label="Note" htmlFor="b-note">
              <Textarea id="b-note" name="note" rows={2} defaultValue={bill?.note} placeholder="Optional" />
            </Field>
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
