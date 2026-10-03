"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { uid } from "@/lib/uid";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

/**
 * Runs a server action with double-submit protection:
 * - `pending` disables the button while the request runs,
 * - a stable idempotency key is sent so a retry/double click is applied once,
 * - a fresh key is made after a success.
 */
export function useAction<A extends unknown[], T>(
  action: (key: string, ...args: A) => Promise<ClientResult<T>>,
  opts: { success?: string | ((d: T) => string); onSuccess?: (d: T) => void; onError?: (r: Extract<ClientResult<T>, { ok: false }>) => void } = {},
) {
  const [pending, setPending] = useState(false);
  const keyRef = useRef<string>(uid());
  const busy = useRef(false);

  const run = useCallback(
    async (...args: A): Promise<ClientResult<T> | null> => {
      if (busy.current) return null;
      busy.current = true;
      setPending(true);
      try {
        const res = await action(keyRef.current, ...args);
        if (res.ok) {
          keyRef.current = uid();
          const msg = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
          if (msg) toast.success(msg);
          opts.onSuccess?.(res.data);
        } else {
          toast.error(res.error);
          opts.onError?.(res);
        }
        return res;
      } catch {
        toast.error("Could not reach the server. Check your connection and try again.");
        return null;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action],
  );

  return { run, pending };
}
