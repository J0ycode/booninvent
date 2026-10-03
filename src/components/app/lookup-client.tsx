"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScannerSheet } from "./scanner-sheet";
import { EmptyState } from "./empty-state";

/** Target of the phone Scan button: opens the scanner and shows product + stock per location. */
export function LookupClient() {
  const sp = useSearchParams();
  const [open, setOpen] = useState(sp.get("scan") === "1");
  return (
    <>
      <EmptyState
        icon={<ScanLine className="size-6" aria-hidden />}
        title="Check a product"
        description="Scan a barcode or type a code to see the product and its stock."
        action={
          <Button onClick={() => setOpen(true)}>
            <ScanLine /> Open scanner
          </Button>
        }
      />
      <ScannerSheet open={open} onOpenChange={setOpen} mode="lookup" title="Check a product" />
    </>
  );
}
