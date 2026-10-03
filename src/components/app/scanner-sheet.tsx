"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, Minus, Plus, ScanLine } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupCodeAction, type LookupResult } from "@/app/_actions/lookup";
import { money, qtyFmt } from "@/lib/format";

type Phase = "scanning" | "loading" | "found" | "notfound";

export interface PickedItem {
  product: LookupResult["product"];
  quantity: number;
}

/** Quantity stepper with large touch targets and a numeric keypad. */
export function QtyStepper({ value, onChange, min = 1, max, id, label = "Quantity" }: { value: number; onChange: (n: number) => void; min?: number; max?: number; id?: string; label?: string }) {
  const clamp = (n: number) => Math.max(min, max !== undefined ? Math.min(max, n) : n);
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <Button type="button" variant="outline" size="icon" aria-label="Decrease" onClick={() => onChange(clamp(value - 1))} disabled={value <= min}>
        <Minus />
      </Button>
      <Input
        id={id}
        aria-label={label}
        className="num w-20 text-center"
        inputMode="numeric"
        pattern="[0-9]*"
        value={String(value)}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, "") || "0", 10);
          onChange(clamp(n));
        }}
      />
      <Button type="button" variant="outline" size="icon" aria-label="Increase" onClick={() => onChange(clamp(value + 1))} disabled={max !== undefined && value >= max}>
        <Plus />
      </Button>
    </div>
  );
}

/**
 * Full-screen camera scanner (phone / tablet). Shows an item card after each scan.
 * mode "pick": quantity stepper + Add (keeps scanning). mode "lookup": shows stock per location.
 * mode "find": calls onPick as soon as a product is found (used by search boxes).
 * If camera permission is denied, the user can type the code instead.
 */
export function ScannerSheet(props: ScannerSheetProps) {
  // Remount on open so every session starts with fresh state.
  return <ScannerSheetInner key={props.open ? "open" : "closed"} {...props} />;
}

interface ScannerSheetProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mode: "pick" | "lookup" | "find";
  onPick?: (item: PickedItem) => void;
  title?: string;
}

function ScannerSheetInner({
  open,
  onOpenChange,
  mode,
  onPick,
  title,
}: ScannerSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("scanning");
  const [camError, setCamError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [code, setCode] = useState("");
  const [qty, setQty] = useState(1);
  const phaseRef = useRef<Phase>("scanning");
  const modeRef = useRef(mode);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    phaseRef.current = phase;
    modeRef.current = mode;
    onPickRef.current = onPick;
  });

  const lookup = useCallback(async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setCode(v);
    setPhase("loading");
    const res = await lookupCodeAction("", v).catch(() => null);
    if (res && res.ok && res.data) {
      if (modeRef.current === "find") {
        onPickRef.current?.({ product: res.data.product, quantity: 1 });
        setPhase("scanning");
        return;
      }
      setResult(res.data);
      setQty(1);
      setPhase("found");
      if (navigator.vibrate) navigator.vibrate(40);
    } else {
      setResult(null);
      setPhase("notfound");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCamError("This browser cannot use the camera here. Type the code below instead.");
        return;
      }
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 150 });
        // Wait for the sheet to mount the <video>.
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled || !videoRef.current) return;
        controlsRef.current = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: "environment" } }, audio: false },
          videoRef.current,
          (res) => {
            if (!res || phaseRef.current !== "scanning") return;
            const text = res.getText();
            const now = Date.now();
            if (lastCode.current && lastCode.current.code === text && now - lastCode.current.at < 2000) return;
            lastCode.current = { code: text, at: now };
            void lookup(text);
          },
        );
        if (cancelled) controlsRef.current.stop();
      } catch (e) {
        const name = (e as { name?: string }).name;
        setCamError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "Camera permission was denied. You can allow it in your browser settings, or type the code below."
            : "The camera could not start. Type the code below instead.",
        );
      }
    })();
    return () => {
      cancelled = true;
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [open, lookup]);

  const scanNext = () => {
    setResult(null);
    setCode("");
    setPhase("scanning");
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-dvh max-h-dvh gap-0 p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] data-[side=bottom]:max-w-none">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{title ?? "Scan a barcode"}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
            {camError ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white">
                <CameraOff className="size-8" aria-hidden />
                {camError}
              </div>
            ) : (
              <>
                <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay aria-label="Camera preview" />
                <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-primary/80" aria-hidden />
                {phase === "scanning" && (
                  <p className="absolute inset-x-0 bottom-2 text-center text-xs text-white/90">
                    <Camera className="mr-1 inline size-3.5" aria-hidden />
                    Point the camera at the barcode
                  </p>
                )}
              </>
            )}
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = String(new FormData(e.currentTarget).get("code") ?? "");
              void lookup(v);
            }}
          >
            <Input name="code" aria-label="Type a barcode or SKU" placeholder="Type barcode or SKU" autoComplete="off" autoCapitalize="characters" key={phase === "scanning" ? "s" : "x"} />
            <Button type="submit" variant="secondary" disabled={phase === "loading"}>
              Find
            </Button>
          </form>

          <div aria-live="polite">
            {phase === "loading" && <p className="text-sm text-muted-foreground">Looking up {code}…</p>}
            {phase === "notfound" && (
              <div className="rounded-xl border bg-card p-4">
                <p className="font-semibold">No product found</p>
                <p className="mt-1 text-sm text-muted-foreground">Nothing matches “{code}”. Check the code and try again.</p>
                <Button className="mt-3 w-full" variant="outline" onClick={scanNext}>
                  <ScanLine /> Scan again
                </Button>
              </div>
            )}
            {phase === "found" && result && (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-lg font-semibold">{result.product.name}</p>
                <p className="num mt-0.5 text-sm text-muted-foreground">
                  {result.product.sku} · {result.product.barcode} · {money(result.product.sellingPrice)}
                </p>
                {mode === "lookup" && (
                  <ul className="mt-3 divide-y text-sm">
                    {result.levels.map((l) => (
                      <li key={l.locationId} className="flex justify-between py-1.5">
                        <span>{l.name}</span>
                        <span className="num font-semibold">{qtyFmt(l.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {mode === "pick" ? (
                  <div className="mt-4 flex flex-col gap-3">
                    <QtyStepper value={qty} onChange={setQty} id="scan-qty" />
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1" onClick={scanNext}>
                        Skip
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => {
                          onPick?.({ product: result.product, quantity: qty });
                          scanNext();
                        }}
                      >
                        Add {qty}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button className="mt-3 w-full" variant="outline" onClick={scanNext}>
                    <ScanLine /> Scan another
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="border-t p-4">
          <Button variant="secondary" className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
