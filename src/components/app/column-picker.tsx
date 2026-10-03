"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CheckboxInput } from "./form-field";

/**
 * Chooses which report columns appear in the preview and the CSV. The choice lives in the `cols` URL param
 * (comma-separated keys; absent = every column), so the Download link and a shared link carry it too.
 */
export function ColumnPicker({ columns, selected }: { columns: { key: string; header: string }[]; selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const chosen = new Set(selected);
  const all = chosen.size === columns.length;

  const apply = (keys: Set<string>) => {
    const q = new URLSearchParams(sp.toString());
    // Keep the report's own column order; "all columns" is stored as no param.
    const list = columns.filter((c) => keys.has(c.key)).map((c) => c.key);
    if (list.length === columns.length) q.delete("cols");
    else q.set("cols", list.join(","));
    start(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  const toggle = (key: string, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    if (next.size === 0) return; // a report needs at least one column
    apply(next);
  };

  return (
    <details className="mb-4 rounded-xl border bg-card">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-medium">
        Columns: {all ? "all" : `${chosen.size} of ${columns.length}`}
      </summary>
      <fieldset className="border-t px-4 py-3" aria-busy={pending}>
        <legend className="sr-only">Columns to show and export</legend>
        <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          {columns.map((c) => {
            const id = `col-${c.key}`;
            const checked = chosen.has(c.key);
            return (
              <label key={c.key} htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                <CheckboxInput id={id} checked={checked} disabled={checked && chosen.size === 1} onChange={(e) => toggle(c.key, e.target.checked)} />
                <span className="truncate">{c.header}</span>
              </label>
            );
          })}
        </div>
        {!all && (
          <button type="button" className="mt-2 min-h-11 text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => apply(new Set(columns.map((c) => c.key)))}>
            Show all columns
          </button>
        )}
      </fieldset>
    </details>
  );
}
