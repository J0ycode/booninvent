"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-field";
import { resetPasswordAction } from "../actions";

function ResetForm() {
  const sp = useSearchParams();
  const token = sp.get("token") ?? "";
  const invite = sp.get("invite") === "1";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== fd.get("confirm")) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    const res = await resetPasswordAction({ token, password }).catch(() => null);
    if (!res || !res.ok) {
      setBusy(false);
      return setError(res ? res.error : "Could not reach the server. Try again.");
    }
    window.location.assign(res.data.redirectTo);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">{invite ? "Set your password" : "Choose a new password"}</h1>
        {invite && <p className="mt-1 text-sm text-muted-foreground">Welcome! Set a password to finish joining your shop.</p>}
      </div>
      {!token && <p className="text-sm text-destructive">This link is missing its code. Please open the link from your email again.</p>}
      {error && (
        <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-tint-foreground">
          {error}
        </p>
      )}
      <Field label="New password" htmlFor="password" hint="At least 8 characters">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm password" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <Button type="submit" disabled={busy || !token} className="w-full">
        {busy ? "Saving…" : "Save password"}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
