"use client";

import { useState } from "react";
import { CheckboxInput } from "@/components/app/form-field";
import { useAction } from "@/hooks/use-action";
import { setLowStockEmailAction } from "./actions";

/** One switch: the daily low-stock summary email for the shop's owners. Saves as soon as it is changed. */
export function AlertsForm({ enabled }: { enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const { run, pending } = useAction(setLowStockEmailAction, {
    success: (d) => (d.enabled ? "Daily low-stock email turned on" : "Daily low-stock email turned off"),
    onError: () => setOn(enabled),
  });
  return (
    <label htmlFor="lowStockEmail" className="flex min-h-11 cursor-pointer items-start gap-3">
      <CheckboxInput
        id="lowStockEmail"
        className="mt-0.5"
        checked={on}
        disabled={pending}
        onChange={(e) => {
          setOn(e.target.checked);
          run(e.target.checked);
        }}
      />
      <span>
        <span className="block text-sm font-medium">Email me a low-stock summary every morning</span>
        <span className="block text-sm text-muted-foreground">
          Sent to every owner of this shop at about 8 am, listing items at or below their reorder level in the Store Room and each store. No email is sent on days when
          nothing is low.
        </span>
      </span>
    </label>
  );
}
