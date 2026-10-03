"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Field, NativeSelect, CheckboxInput } from "@/components/app/form-field";
import { DataTable } from "@/components/app/data-table";
import { Section } from "@/components/app/section";
import { Status } from "@/components/app/status-chip";
import { useAction } from "@/hooks/use-action";
import { ROLE_LABEL, TENANT_ROLES, type TenantRole } from "@/lib/roles";
import { date } from "@/lib/format";
import type { UserView } from "@/server/data/users";
import type { LocationView } from "@/server/data/locations";
import { inviteUserAction, updateUserAction, resendInviteAction, addStoreAction, renameLocationAction } from "./actions";

type Editing = { mode: "invite" } | { mode: "edit"; user: UserView } | null;

function UserDialog({ editing, stores, onClose, meId }: { editing: Editing; stores: LocationView[]; onClose: () => void; meId: string }) {
  const router = useRouter();
  const user = editing?.mode === "edit" ? editing.user : null;
  const [role, setRole] = useState<TenantRole>((user?.role as TenantRole) ?? "STORE_STAFF");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const invite = useAction(inviteUserAction, {
    success: "Invite sent",
    onSuccess: () => {
      onClose();
      router.refresh();
    },
    onError: (r) => setErrors(r.fieldErrors ?? {}),
  });
  const update = useAction(updateUserAction, {
    success: "Saved",
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  });
  const pending = invite.pending || update.pending;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const locationId = String(fd.get("locationId") ?? "");
    if (user) {
      update.run(user.id, { role, locationId, active: fd.get("active") === "on" });
    } else {
      invite.run({ name: fd.get("name"), email: fd.get("email"), role, locationId });
    }
  }

  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : "Invite a person"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4" key={user?.id ?? "new"}>
          {!user && (
            <>
              <Field label="Name" htmlFor="u-name" error={errors.name}>
                <Input id="u-name" name="name" required autoComplete="off" />
              </Field>
              <Field label="Email" htmlFor="u-email" error={errors.email}>
                <Input id="u-email" name="email" type="email" inputMode="email" required autoComplete="off" />
              </Field>
            </>
          )}
          <Field label="Role" htmlFor="u-role">
            <NativeSelect id="u-role" value={role} onChange={(e) => setRole(e.target.value as TenantRole)} disabled={user?.id === meId}>
              {TENANT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          {role === "STORE_STAFF" && (
            <Field label="Store" htmlFor="u-store" error={errors.locationId}>
              <NativeSelect id="u-store" name="locationId" defaultValue={user?.locationIds[0] ?? stores[0]?.id} required>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {user && user.id !== meId && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <CheckboxInput name="active" defaultChecked={user.active} />
              Account active (can sign in)
            </label>
          )}
          {user?.id === meId && <input type="hidden" name="active" value="on" />}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : user ? "Save" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LocationDialog({ loc, open, onClose }: { loc: LocationView | null; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const opts = {
    success: loc ? "Renamed" : "Store added",
    onSuccess: () => {
      onClose();
      router.refresh();
    },
  };
  const add = useAction(addStoreAction, opts);
  const rename = useAction(renameLocationAction, opts);
  const pending = add.pending || rename.pending;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{loc ? `Rename ${loc.name}` : "Add a store"}</DialogTitle>
        </DialogHeader>
        <form
          key={loc?.id ?? "new"}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            if (loc) rename.run(loc.id, { name });
            else add.run({ name });
          }}
        >
          <Field label="Name" htmlFor="loc-name">
            <Input id="loc-name" name="name" defaultValue={loc?.name} required minLength={2} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function UsersClient({ users, locations, meId }: { users: UserView[]; locations: LocationView[]; meId: string }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [locDialog, setLocDialog] = useState<{ open: boolean; loc: LocationView | null }>({ open: false, loc: null });
  const resend = useAction(resendInviteAction, { success: "Invite sent again" });
  const stores = locations.filter((l) => l.type === "STORE");
  const locName = (id?: string) => locations.find((l) => l.id === id)?.name ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <Section
        title="People"
        actions={
          <Button onClick={() => setEditing({ mode: "invite" })}>
            <Plus /> Invite
          </Button>
        }
      >
        <DataTable
          caption="People"
          columns={[
            { id: "name", header: "Name", primary: true },
            { id: "role", header: "Role" },
            { id: "store", header: "Store" },
            { id: "status", header: "Status" },
            { id: "last", header: "Last sign-in", hideOnPhone: true },
            { id: "actions", header: "", align: "right" },
          ]}
          rows={users.map((u) => ({
            id: u.id,
            cells: {
              name: (
                <span>
                  {u.name}
                  <span className="block text-xs font-normal text-muted-foreground break-all">{u.email}</span>
                </span>
              ),
              role: ROLE_LABEL[u.role],
              store: u.role === "STORE_STAFF" ? locName(u.locationIds[0]) : "All",
              status: <Status value={!u.active ? "INACTIVE" : u.invited ? "INVITED" : "ACTIVE"} />,
              last: date(u.lastLoginAt),
              actions: (
                <span className="flex justify-end gap-1">
                  {u.invited && u.active && (
                    <Button variant="ghost" size="icon" aria-label={`Resend invite to ${u.name}`} disabled={resend.pending} onClick={() => resend.run(u.id)}>
                      <Mail />
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`Edit ${u.name}`} onClick={() => setEditing({ mode: "edit", user: u })}>
                    <Pencil />
                  </Button>
                </span>
              ),
            },
          }))}
        />
      </Section>

      <Section
        title="Locations"
        actions={
          <Button variant="outline" onClick={() => setLocDialog({ open: true, loc: null })}>
            <Plus /> Add store
          </Button>
        }
      >
        <ul className="divide-y">
          {locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{l.name}</p>
                <p className="text-xs text-muted-foreground">{l.type === "STORE_ROOM" ? "Store Room (central stock)" : "Store"}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label={`Rename ${l.name}`} onClick={() => setLocDialog({ open: true, loc: l })}>
                <Pencil />
              </Button>
            </li>
          ))}
        </ul>
      </Section>

      <UserDialog editing={editing} stores={stores} onClose={() => setEditing(null)} meId={meId} />
      <LocationDialog open={locDialog.open} loc={locDialog.loc} onClose={() => setLocDialog({ open: false, loc: null })} />
    </div>
  );
}
