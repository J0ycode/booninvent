"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Camera, Search, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScannerSheet } from "./scanner-sheet";
import { EmptyState } from "./empty-state";
import { searchProductsAction, type PickerProduct } from "@/app/_actions/products";
import { lookupCodeAction } from "@/app/_actions/lookup";
import { qtyFmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface Line {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  quantity: number;
  /** Rupees as typed (receive stock only). */
  cost?: string;
  /** Stock at the source location, when known. */
  available?: number;
  /** Selling price in paise (label preview). */
  price?: number;
}

/**
 * Search, scan or USB-scan products into a list of lines with quantities.
 * Adding the same product again increases its quantity.
 */
export function LinesEditor({
  lines,
  onChange,
  showCost,
  availableAt,
  emptyHint = "Search or scan products to add them.",
  qtyLabel = "Qty",
}: {
  lines: Line[];
  onChange: (l: Line[]) => void;
  showCost?: boolean;
  /** Location id: shows "available" and warns when a line asks for more. */
  availableAt?: string;
  emptyHint?: string;
  qtyLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PickerProduct[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqId = useRef(0);
  const listId = useId();
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  });

  const add = (p: Omit<Line, "quantity">, quantity = 1) => {
    const cur = linesRef.current;
    const i = cur.findIndex((l) => l.productId === p.productId);
    const next = i >= 0 ? cur.map((l, j) => (j === i ? { ...l, quantity: l.quantity + quantity } : l)) : [...cur, { ...p, quantity }];
    linesRef.current = next;
    onChange(next);
  };

  const search = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (!value.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const id = ++reqId.current;
      const res = await searchProductsAction("", value, availableAt).catch(() => null);
      if (id !== reqId.current) return;
      setSearching(false);
      setResults(res && res.ok ? res.data : []);
      setOpen(true);
    }, 250);
  };

  const pick = (p: PickerProduct) => {
    add({ productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, available: p.available, price: p.sellingPrice });
    setQ("");
    setResults([]);
    setOpen(false);
  };

  /** Enter: exact barcode/SKU (USB scanner) adds immediately; otherwise picks the single result. */
  const onEnter = async () => {
    const v = q.trim();
    if (!v) return;
    const res = await lookupCodeAction("", v).catch(() => null);
    if (res && res.ok && res.data) {
      const p = res.data.product;
      const available = availableAt ? res.data.levels.find((l) => l.locationId === availableAt)?.quantity : undefined;
      add({ productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, available, price: p.sellingPrice });
      setQ("");
      setResults([]);
      setOpen(false);
    } else if (results.length === 1) {
      pick(results[0]);
    } else if (!results.length) {
      toast.error(`No product found for “${v}”.`);
    }
  };

  const update = (i: number, patch: Partial<Line>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            className="pl-9"
            placeholder="Search name or SKU, or scan a barcode"
            aria-label="Add product: search name or SKU, or scan a barcode"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            autoComplete="off"
            enterKeyHint="go"
            onChange={(e) => {
              setQ(e.target.value);
              search(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void onEnter();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onFocus={() => results.length && setOpen(true)}
          />
          {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />}
          {open && q && (
            <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
              {results.length === 0 && !searching && <li className="p-3 text-sm text-muted-foreground">No matching products.</li>}
              {results.map((p) => (
                <li key={p.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(p)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="num block text-xs text-muted-foreground">{p.sku}</span>
                    </span>
                    {p.available !== undefined && <span className="num shrink-0 text-xs text-muted-foreground">{qtyFmt(p.available)} available</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button type="button" variant="outline" size="icon" aria-label="Scan with camera" onClick={() => setScanOpen(true)}>
          <Camera />
        </Button>
      </div>

      {lines.length === 0 ? (
        <EmptyState title="No products added" description={emptyHint} />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {lines.map((l, i) => {
            const over = l.available !== undefined && l.quantity > l.available;
            return (
              <li key={l.productId} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <p className="num text-xs text-muted-foreground">
                    {l.sku}
                    {l.available !== undefined && <> · {qtyFmt(l.available)} available</>}
                  </p>
                  {over && <p className="text-xs font-medium text-destructive">More than available</p>}
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                    {qtyLabel}
                    <Input
                      className={cn("num h-11 w-20 text-right", over && "border-destructive")}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      aria-label={`Quantity for ${l.name}`}
                      value={l.quantity ? String(l.quantity) : ""}
                      onChange={(e) => update(i, { quantity: parseInt(e.target.value.replace(/\D/g, "") || "0", 10) })}
                    />
                  </label>
                  {showCost && (
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Cost ₹ (optional)
                      <Input
                        className="num h-11 w-28 text-right"
                        inputMode="decimal"
                        aria-label={`Cost per piece for ${l.name}`}
                        value={l.cost ?? ""}
                        onChange={(e) => update(i, { cost: e.target.value })}
                      />
                    </label>
                  )}
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.name}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              </li>
            );
          })}
          <li className="flex justify-between p-3 text-sm font-semibold">
            <span>
              {lines.length} {lines.length === 1 ? "product" : "products"}
            </span>
            <span className="num">{qtyFmt(total)} pieces</span>
          </li>
        </ul>
      )}

      <ScannerSheet
        open={scanOpen}
        onOpenChange={setScanOpen}
        mode="pick"
        title="Scan products"
        onPick={({ product, quantity }) => {
          add({ productId: product.id, name: product.name, sku: product.sku, barcode: product.barcode, price: product.sellingPrice }, quantity);
          toast.success(`Added ${quantity} × ${product.name}`);
        }}
      />
    </div>
  );
}

/** Rupees string -> paise, or null when empty. */
export function rupeesToPaiseClient(v: string | undefined): number | null {
  if (!v || !v.trim()) return null;
  const n = Number(v.replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}
