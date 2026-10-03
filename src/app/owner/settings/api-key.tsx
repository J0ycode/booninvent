"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { useAction } from "@/hooks/use-action";
import { dateTime } from "@/lib/format";
import type { ApiKeyInfo } from "@/server/data/apikeys";
import { rotateApiKeyAction, revokeApiKeyAction } from "./actions";

/** Create / rotate / revoke the per-shop sales API key. The full key is shown once. */
export function ApiKeyPanel({ info, stores }: { info: ApiKeyInfo | null; stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [plain, setPlain] = useState<string | null>(null);
  const rotate = useAction(rotateApiKeyAction, {
    success: "New key created. Copy it now.",
    onSuccess: (r) => {
      setPlain(r.key);
      router.refresh();
    },
  });
  const revoke = useAction(revokeApiKeyAction, {
    success: "Key revoked",
    onSuccess: () => {
      setPlain(null);
      router.refresh();
    },
  });
  const busy = rotate.pending || revoke.pending;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        The billing module uses this key to call <span className="font-mono text-xs">POST /api/v1/sales</span>, which reduces a store&apos;s stock. Keep it secret.
      </p>
      {plain && (
        <div className="rounded-xl border border-primary/40 bg-accent p-3">
          <p className="mb-2 font-medium">Copy this key now. It will not be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 rounded-lg bg-card px-2 py-2 font-mono text-xs break-all">{plain}</code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy key"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(plain);
                  toast.success("Copied");
                } catch {
                  toast.error("Could not copy. Select the key and copy it by hand.");
                }
              }}
            >
              <Copy />
            </Button>
          </div>
        </div>
      )}
      {info ? (
        <p className="flex items-center gap-2">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          Active key <span className="font-mono text-xs">{info.prefix}…</span> · created {dateTime(info.createdAt)} · last used {dateTime(info.lastUsedAt)}
        </p>
      ) : (
        <p>No active key.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {info ? (
          <>
            <ConfirmDialog
              title="Rotate the API key?"
              description="A new key is created and the current one stops working immediately. Update the billing module with the new key."
              confirmLabel="Rotate key"
              onConfirm={() => rotate.run()}
              trigger={(open) => (
                <Button variant="outline" onClick={open} disabled={busy}>
                  <RefreshCw /> Rotate key
                </Button>
              )}
            />
            <ConfirmDialog
              title="Revoke the API key?"
              description="The billing module will not be able to record sales until you create a new key."
              confirmLabel="Revoke"
              destructive
              onConfirm={() => revoke.run()}
              trigger={(open) => (
                <Button variant="destructive" onClick={open} disabled={busy}>
                  Revoke
                </Button>
              )}
            />
          </>
        ) : (
          <Button onClick={() => rotate.run()} disabled={busy}>
            <KeyRound /> Create API key
          </Button>
        )}
      </div>
      <details className="rounded-xl border p-3">
        <summary className="min-h-11 cursor-pointer content-center font-medium">Store ids for the API</summary>
        <ul className="mt-2 flex flex-col gap-1">
          {stores.map((s) => (
            <li key={s.id} className="flex flex-wrap justify-between gap-2">
              <span>{s.name}</span>
              <code className="font-mono text-xs break-all">{s.id}</code>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
