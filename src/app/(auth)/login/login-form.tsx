"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-field";
import { loginAction } from "../actions";

const schema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});
type Values = z.infer<typeof schema>;

export function LoginForm({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const res = await loginAction(v).catch(() => null);
    if (!res) return setError("Could not reach the server. Check your connection and try again.");
    if (!res.ok) return setError(res.error);
    const target = next && next.startsWith(res.data.redirectTo) ? next : res.data.redirectTo;
    window.location.assign(target);
  });

  const { errors, isSubmitting, isSubmitSuccessful } = formState;
  const busy = isSubmitting || (isSubmitSuccessful && !error);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <h1 className="text-xl font-bold">Sign in</h1>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-tint-foreground">
          {error}
        </p>
      )}
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" aria-invalid={!!errors.email} {...register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...register("password")} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <div className="flex flex-col gap-1 text-center text-sm">
        <Link href="/forgot-password" className="inline-flex min-h-11 items-center justify-center text-primary hover:underline">
          Forgot password?
        </Link>
        <p className="text-muted-foreground">
          New shop?{" "}
          <Link href="/signup" className="inline-flex min-h-11 items-center text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </form>
  );
}
