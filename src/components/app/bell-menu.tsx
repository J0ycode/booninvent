"use client";

import Link from "next/link";
import { useState } from "react";
import { Bell } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { StatusChip } from "./status-chip";
import type { Notice } from "@/server/data/dashboard";

export function BellMenu({ items }: { items: Notice[] }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="icon" className="relative" aria-label={total ? `Notifications: ${total} items need attention` : "Notifications: nothing new"}>
            <Bell />
            {total > 0 && (
              <span className="num absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-white" aria-hidden>
                {total > 99 ? "99+" : total}
              </span>
            )}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <p className="px-2 pt-1 pb-2 text-sm font-semibold">Needs attention</p>
        {items.length === 0 ? (
          <p className="px-2 pb-2 text-sm text-muted-foreground">You are all caught up.</p>
        ) : (
          <ul className="flex flex-col">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={i.href} onClick={() => setOpen(false)} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-muted">
                  <span>{i.label}</span>
                  <StatusChip tone={i.tone}>{i.count}</StatusChip>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
