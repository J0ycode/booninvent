"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/app/form-field";
import { signupAction } from "../actions";

const schema = z.object({
  shopName: z.string().trim().min(2, "Enter the shop name"),
  storeName: z.string().trim().min(2, "Enter the first store's name"),
  ownerName: z.string().trim().min(2, "Enter your name"),
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "Use at least 8 characters"),
});
type Values = z.infer<typeof schema>;

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { storeName: "Store A" },
  });
  const { errors, isSubmitting } = formState;

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    const res = await signupAction(v).catch(() => null);
    if (!res) return setError("Could not reach the server. Check your connection and try again.");
    if (!res.ok) return setError(res.error);
    setDone(true);
    window.location.assign(res.data.redirectTo);
  });

  const busy = isSubmitting || done;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div>
        <h1 className="text-xl font-bold">Create your shop</h1>
        <p className="mt-1 text-sm text-muted-foreground">We set up your Store Room and first store. You can add a second store later.</p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-danger-tint px-3 py-2 text-sm text-danger-tint-foreground">
          {error}
        </p>
      )}
      <Field label="Shop name" htmlFor="shopName" error={errors.shopName?.message}>
        <Input id="shopName" autoComplete="organization" {...register("shopName")} />
      </Field>
      <Field label="First store name" htmlFor="storeName" error={errors.storeName?.message}>
        <Input id="storeName" {...register("storeName")} />
      </Field>
      <Field label="Your name" htmlFor="ownerName" error={errors.ownerName?.message}>
        <Input id="ownerName" autoComplete="name" {...register("ownerName")} />
      </Field>
      <Field label="Email" htmlFor="email" error={errors.email?.message}>
        <Input id="email" type="email" inputMode="email" autoComplete="email" {...register("email")} />
      </Field>
      <Field label="Password" htmlFor="password" error={errors.password?.message} hint="At least 8 characters">
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? "Creating…" : "Create shop"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="inline-flex min-h-11 items-center text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
