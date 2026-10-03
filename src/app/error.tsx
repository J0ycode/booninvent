"use client";

import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Friendly error screen with retry (slow or dropped connections often succeed on a second try). */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">Please try again. If it keeps happening, check your internet connection or contact support{error.digest ? ` (code ${error.digest})` : ""}.</p>
      <Button onClick={reset}>
        <RotateCw /> Try again
      </Button>
    </main>
  );
}
