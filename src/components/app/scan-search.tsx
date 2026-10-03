"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScannerSheet } from "./scanner-sheet";

/**
 * Search box for inventory lists. Updates ?q= (debounced) for server-side search.
 * USB scanners type the code + Enter (instant search). On touch devices a camera button opens the scanner.
 */
export function ScanSearch({ placeholder = "Search name, SKU or scan barcode", param = "q" }: { placeholder?: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get(param) ?? "");
  const [scanOpen, setScanOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    const q = new URLSearchParams(sp.toString());
    if (v.trim()) q.set(param, v.trim());
    else q.delete(param);
    q.delete("page");
    startTransition(() => router.replace(`${pathname}?${q.toString()}`, { scroll: false }));
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <div className="flex w-full gap-2">
      <form
        role="search"
        className="relative flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          apply(value);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={value}
          aria-label={placeholder}
          placeholder={placeholder}
          className="pl-9"
          autoComplete="off"
          enterKeyHint="search"
          onChange={(e) => {
            const v = e.target.value;
            setValue(v);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => apply(v), 350);
          }}
        />
        {pending && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
      </form>
      <Button type="button" variant="outline" size="icon" className="hidden pointer-coarse:inline-flex" aria-label="Scan with camera" onClick={() => setScanOpen(true)}>
        <Camera />
      </Button>
      <ScannerSheet
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode="find"
        title="Scan to search"
        onPick={({ product }) => {
          setValue(product.barcode);
          apply(product.barcode);
          setScanOpen(false);
        }}
      />
    </div>
  );
}
