"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";

export interface DTColumn {
  id: string;
  header: string;
  align?: "left" | "right";
  /** Shown as the card title on phones. One column should set this. */
  primary?: boolean;
  /** Hide this column in phone card view. */
  hideOnPhone?: boolean;
}
export interface DTRow {
  id: string;
  href?: string;
  cells: Record<string, ReactNode>;
}

/**
 * Table on tablet/desktop, stacked cards on phone.
 * Cells are pre-rendered (server components can pass ReactNodes), so this works with server pagination.
 */
export function DataTable({ columns, rows, caption }: { columns: DTColumn[]; rows: DTRow[]; caption?: string }) {
  const defs: ColumnDef<DTRow>[] = columns.map((c) => ({
    id: c.id,
    header: c.header,
    cell: ({ row }) => row.original.cells[c.id] ?? null,
    meta: c,
  }));
  const table = useReactTable({ data: rows, columns: defs, getCoreRowModel: getCoreRowModel(), getRowId: (r) => r.id });
  const primary = columns.find((c) => c.primary) ?? columns[0];

  return (
    <>
      {/* phone: cards */}
      <ul className="flex flex-col gap-2 md:hidden" aria-label={caption}>
        {rows.map((r) => {
          const inner = (
            <>
              <div className="font-semibold break-words">{r.cells[primary.id]}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {columns
                  .filter((c) => c.id !== primary.id && !c.hideOnPhone)
                  .map((c) => (
                    <div key={c.id} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{c.header}</dt>
                      <dd className="break-words">{r.cells[c.id] ?? "—"}</dd>
                    </div>
                  ))}
              </dl>
            </>
          );
          return (
            <li key={r.id} className="rounded-xl border bg-card p-3 shadow-xs">
              {r.href ? (
                <Link href={r.href} className="block">
                  {inner}
                </Link>
              ) : (
                inner
              )}
            </li>
          );
        })}
      </ul>

      {/* tablet/desktop: table */}
      <div className="hidden overflow-x-auto rounded-xl border bg-card shadow-xs md:block">
        <table className="w-full text-sm">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="bg-muted/60 text-left text-xs text-muted-foreground uppercase">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const m = h.column.columnDef.meta as DTColumn;
                  return (
                    <th key={h.id} scope="col" className={cn("px-3 py-2.5 font-semibold", m.align === "right" && "text-right")}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-t transition-colors hover:bg-muted/40">
                {row.getVisibleCells().map((cell, i) => {
                  const m = cell.column.columnDef.meta as DTColumn;
                  const content = flexRender(cell.column.columnDef.cell, cell.getContext());
                  return (
                    <td key={cell.id} className={cn("px-3 py-2.5 align-middle", m.align === "right" && "num text-right")}>
                      {i === 0 && row.original.href ? (
                        <Link href={row.original.href} className="font-medium text-primary underline-offset-4 hover:underline">
                          {content}
                        </Link>
                      ) : (
                        content
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
