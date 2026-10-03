"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Field, CheckboxInput } from "@/components/app/form-field";
import { DataTable } from "@/components/app/data-table";
import { EmptyState } from "@/components/app/empty-state";
import { Status } from "@/components/app/status-chip";
import { useAction } from "@/hooks/use-action";
import type { SupplierView } from "@/server/data/suppliers";
import { saveSupplierAction } from "../actions";

export function SuppliersClient({ suppliers }: { suppliers: SupplierView[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SupplierView | "new" | null>(null);
  const current = editing === "new" ? null : editing;
  const { run, pending } = useAction(saveSupplierAction, {
    success: "Supplier saved",
    onSuccess: () => {
      setEditing(null);
      router.refresh();
    },
  });

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setEditing("new")}>
          <Plus /> Add supplier
        </Button>
      </div>
      {suppliers.length === 0 ? (
        <EmptyState title="No suppliers yet" description="Add the suppliers you buy stock from. You pick one when receiving stock." />
      ) : (
        <DataTable
          caption="Suppliers"
          columns={[
            { id: "name", header: "Supplier", primary: true },
            { id: "phone", header: "Phone" },
            { id: "gstin", header: "GSTIN", hideOnPhone: true },
            { id: "status", header: "Status" },
            { id: "edit", header: "", align: "right" },
          ]}
          rows={suppliers.map((s) => ({
            id: s.id,
            cells: {
              name: s.name,
              phone: s.phone ?? "—",
              gstin: s.gstin ?? "—",
              status: <Status value={s.active ? "ACTIVE" : "INACTIVE"} />,
              edit: (
                <Button variant="ghost" size="icon" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                  <Pencil />
                </Button>
              ),
            },
          }))}
        />
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && !pending && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{current ? `Edit ${current.name}` : "Add supplier"}</DialogTitle>
          </DialogHeader>
          <form
            key={current?.id ?? "new"}
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(current?.id ?? null, {
                name: fd.get("name"),
                phone: fd.get("phone"),
                email: fd.get("email"),
                gstin: fd.get("gstin"),
                address: fd.get("address"),
                active: current ? fd.get("active") === "on" : true,
              });
            }}
          >
            <Field label="Name" htmlFor="s-name">
              <Input id="s-name" name="name" defaultValue={current?.name} required minLength={2} />
            </Field>
            <Field label="Phone" htmlFor="s-phone">
              <Input id="s-phone" name="phone" type="tel" inputMode="tel" defaultValue={current?.phone} />
            </Field>
            <Field label="Email" htmlFor="s-email">
              <Input id="s-email" name="email" type="email" inputMode="email" defaultValue={current?.email} />
            </Field>
            <Field label="GSTIN" htmlFor="s-gstin">
              <Input id="s-gstin" name="gstin" defaultValue={current?.gstin} />
            </Field>
            <Field label="Address" htmlFor="s-address">
              <Textarea id="s-address" name="address" rows={2} defaultValue={current?.address} />
            </Field>
            {current && (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <CheckboxInput name="active" defaultChecked={current.active} />
                Active
              </label>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={pending}>
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
