"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useTransition } from "react";
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

/** A search box bound to one URL search param. Applies shortly after typing stops, or at once on Enter. */
export function UrlSearch({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  const { set, sp } = useSetParam();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = `f-${name}`;
  const apply = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (value.trim() !== (sp.get(name) ?? "")) set(name, value.trim());
  };
  return (
    <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:!w-64">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="search"
        enterKeyHint="search"
        placeholder={placeholder}
        defaultValue={sp.get(name) ?? ""}
        onChange={(e) => {
          const value = e.target.value;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => apply(value), 400);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply(e.currentTarget.value);
        }}
      />
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end [&>*]:sm:w-44">{children}</div>;
}
