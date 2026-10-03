"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect, ActionBar } from "@/components/app/form-field";
import { LinesEditor, type Line } from "@/components/app/lines-editor";
import { Section } from "@/components/app/section";
import { A4, LABEL_PRESETS, MAX_LABELS, slotPosition } from "@/lib/label-presets";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { receiptLinesAction } from "./actions";

type PresetKey = 24 | 40 | 65;

function BarcodeSvg({ value }: { value: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let alive = true;
    import("bwip-js/browser")
      .then((b) => {
        if (alive) setSvg(b.toSVG({ bcid: "code128", text: value, height: 8, includetext: false }));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [value]);
  return <div className="h-full w-full [&_svg]:h-full [&_svg]:w-full" aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function LabelsClient({ receipts, initialReceiptId }: { receipts: { id: string; label: string }[]; initialReceiptId?: string }) {
  const [source, setSource] = useState<"pick" | "receipt">(initialReceiptId ? "receipt" : "pick");
  const [receiptId, setReceiptId] = useState(initialReceiptId ?? "");
  const [lines, setLines] = useState<Line[]>([]);
  const [preset, setPreset] = useState<PresetKey>(24);
  const [start, setStart] = useState(1);
  const [busy, setBusy] = useState<"print" | "download" | null>(null);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const p = LABEL_PRESETS[preset];

  useEffect(() => {
    if (source !== "receipt" || !receiptId) return;
    let alive = true;
    // Async fetch; state updates happen after the await.
    (async () => {
      setLoadingReceipt(true);
      const res = await receiptLinesAction("", receiptId).catch(() => null);
      if (!alive) return;
      setLoadingReceipt(false);
      if (res?.ok) setLines(res.data);
      else toast.error("Could not load that receipt.");
    })();
    return () => {
      alive = false;
    };
  }, [source, receiptId]);

  const total = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  const sheets = total ? Math.ceil((start - 1 + total) / p.perSheet) : 0;
  const firstSheet = useMemo(() => {
    const slots: (Line | null)[] = Array(p.perSheet).fill(null);
    let slot = start - 1;
    for (const l of lines) {
      for (let i = 0; i < l.quantity && slot < p.perSheet; i++) slots[slot++] = l;
      if (slot >= p.perSheet) break;
    }
    return slots;
  }, [lines, start, p.perSheet]);

  const job = () => ({ preset, startPosition: start, items: lines.filter((l) => l.quantity > 0).map((l) => ({ productId: l.productId, count: l.quantity })) });

  async function fetchPdf(): Promise<Blob | null> {
    const res = await fetch("/api/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(job()) }).catch(() => null);
    if (!res) {
      toast.error("Could not reach the server. Check your connection and try again.");
      return null;
    }
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      toast.error(j?.error?.message ?? "Could not create the labels.");
      return null;
    }
    return res.blob();
  }

  async function download() {
    setBusy("download");
    const blob = await fetchPdf();
    setBusy(null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `labels-${preset}-${new Date().toISOString().slice(0, 10)}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function print() {
    setBusy("print");
    const blob = await fetchPdf();
    setBusy(null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const frame = frameRef.current;
    // Phones cannot print from a hidden frame: open the PDF so the system viewer can print it.
    if (!frame || window.matchMedia("(pointer: coarse)").matches) {
      window.open(url, "_blank", "noopener");
      return;
    }
    frame.onload = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } catch {
        window.open(url, "_blank", "noopener");
      }
    };
    frame.src = url;
  }

  // Preview scale: fit the sheet into the column width.
  const previewW = 340;
  const scale = previewW / A4.width;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="flex min-w-0 flex-col gap-6">
        <Section title="1. Products">
          <div className="mb-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Label source">
            {(
              [
                ["pick", "Pick products"],
                ["receipt", "From a recent receipt"],
              ] as const
            ).map(([v, label]) => (
              <Button key={v} role="radio" aria-checked={source === v} variant={source === v ? "secondary" : "outline"} onClick={() => setSource(v)}>
                {label}
              </Button>
            ))}
          </div>
          {source === "receipt" && (
            <Field label="Receipt" htmlFor="receipt" className="mb-4" hint={loadingReceipt ? "Loading…" : "One label per received piece. You can change the counts below."}>
              <NativeSelect id="receipt" value={receiptId} onChange={(e) => setReceiptId(e.target.value)}>
                <option value="">Choose a receipt</option>
                {receipts.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          <LinesEditor lines={lines} onChange={setLines} qtyLabel="Labels" emptyHint="Add products and how many labels each needs." />
        </Section>
        <Section title="2. Sheet">
          <Field label="Sticker sheet (A4)" htmlFor="preset">
            <NativeSelect
              id="preset"
              value={preset}
              onChange={(e) => {
                setPreset(Number(e.target.value) as PresetKey);
                setStart(1);
              }}
            >
              {Object.values(LABEL_PRESETS).map((x) => (
                <option key={x.perSheet} value={x.perSheet}>
                  {x.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <p className="mt-4 mb-2 text-sm font-medium" id="start-label">
            Start at label {start} <span className="font-normal text-muted-foreground">(tap the first empty sticker on a used sheet)</span>
          </p>
          <div role="radiogroup" aria-labelledby="start-label" className="grid max-w-sm gap-1" style={{ gridTemplateColumns: `repeat(${p.cols}, minmax(0, 1fr))` }}>
            {Array.from({ length: p.perSheet }, (_, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={start === i + 1}
                aria-label={`Start at label ${i + 1}`}
                onClick={() => setStart(i + 1)}
                className={cn(
                  "num min-h-7 rounded-md border text-[10px] transition-colors",
                  i + 1 < start && "border-dashed bg-muted text-muted-foreground line-through",
                  i + 1 === start && "border-primary bg-primary text-primary-foreground",
                  i + 1 > start && "bg-card hover:border-primary/50",
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        <Section title="Preview (first sheet)">
          <div className="mx-auto overflow-hidden rounded-md border bg-white shadow-sm" style={{ width: previewW, height: A4.height * scale, position: "relative" }} aria-label="Sheet preview">
            {firstSheet.map((l, i) => {
              const pos = slotPosition(p, i);
              return (
                <div
                  key={i}
                  className={cn("absolute overflow-hidden border border-dashed border-gray-200 text-black", i < start - 1 && "bg-gray-100")}
                  style={{ left: pos.x * scale, top: pos.y * scale, width: p.width * scale, height: p.height * scale, padding: 1.5 }}
                >
                  {l && (
                    <div className="flex h-full flex-col" style={{ fontSize: preset === 65 ? 4 : preset === 40 ? 5 : 6, lineHeight: 1.15 }}>
                      <span className="truncate font-bold">{l.name}</span>
                      <span className="flex justify-between">
                        <b>{l.price !== undefined ? money(l.price) : ""}</b>
                        <span className="truncate">{l.sku}</span>
                      </span>
                      <span className="min-h-0 flex-1">
                        <BarcodeSvg value={l.barcode} />
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <p className="num mt-3 text-center text-sm text-muted-foreground">
            {total} label{total === 1 ? "" : "s"} · {sheets} sheet{sheets === 1 ? "" : "s"}
          </p>
          {total > MAX_LABELS && <p className="text-center text-sm text-destructive">Print up to {MAX_LABELS} labels at a time.</p>}
        </Section>
        <ActionBar>
          <Button variant="outline" onClick={download} disabled={!total || total > MAX_LABELS || busy !== null}>
            <Download /> {busy === "download" ? "Preparing…" : "Download PDF"}
          </Button>
          <Button onClick={print} disabled={!total || total > MAX_LABELS || busy !== null}>
            <Printer /> {busy === "print" ? "Preparing…" : "Print"}
          </Button>
        </ActionBar>
        <p className="text-xs text-muted-foreground">Print at 100% scale (turn off &quot;fit to page&quot;) so the labels line up with the stickers.</p>
      </div>
      <iframe ref={frameRef} title="Print labels" className="hidden" />
    </div>
  );
}
