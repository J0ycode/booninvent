"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { NativeSelect } from "./form-field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function useSetParam() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (name: string, value: string) => {
    const q = new URLSearchParams(sp.toString());
    if (value) q.set(name, value);
    else q.delete(name);
    q.delete("page");
    start(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  };
  return { set, sp, pending };
}

/** A select bound to one URL search param (server-side filtering). */
export function UrlSelect({ name, label, options }: { name: string; label: string; options: { value: string; label: string }[] }) {
  const { set, sp, pending } = useSetParam();
  const id = `f-${name}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <NativeSelect id={id} value={sp.get(name) ?? ""} onChange={(e) => set(name, e.target.value)} aria-busy={pending}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

/** A date input bound to one URL search param. */
export function UrlDate({ name, label }: { name: string; label: string }) {
  const { set, sp } = useSetParam();
  const id = `f-${name}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input id={id} type="date" value={sp.get(name) ?? ""} onChange={(e) => set(name, e.target.value)} />
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end [&>*]:sm:w-44">{children}</div>;
}
