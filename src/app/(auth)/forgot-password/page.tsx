"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-field";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "");
    const res = await forgotPasswordAction({ email }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Could not reach the server. Try again.");
    if (!res.ok) return setError(res.error);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-bold">Check your email</h1>
        <p className="text-sm text-muted-foreground">If an account exists for that email, we sent a link to reset the password. The link expires in 1 hour.</p>
        <Link href="/login" className="inline-flex min-h-11 items-center text-sm text-primary hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">Reset password</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter your email and we will send you a reset link.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-tint-foreground">
          {error}
        </p>
      )}
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" inputMode="email" autoComplete="email" required />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Sending…" : "Send reset link"}
      </Button>
      <Link href="/login" className="inline-flex min-h-11 items-center justify-center text-sm text-primary hover:underline">
        Back to sign in
      </Link>
    </form>
  );
}
