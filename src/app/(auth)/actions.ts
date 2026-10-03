"use server";

import { cookies, headers } from "next/headers";
import { login, signup, requestPasswordReset, resetPassword, type LoginResult } from "@/server/data/auth";
import { SESSION_COOKIE, sessionCookieOptions } from "@/server/auth/session";
import { errorResult, type ActionResult } from "@/server/action";
import { PORTAL_BY_ROLE } from "@/lib/roles";

async function startSession(r: LoginResult): Promise<ActionResult<{ redirectTo: string }>> {
  (await cookies()).set(SESSION_COOKIE, r.token, sessionCookieOptions);
  return { ok: true, data: { redirectTo: PORTAL_BY_ROLE[r.role] } };
}

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function loginAction(input: { email: string; password: string }) {
  try {
    return await startSession(await login(input, await clientIp()));
  } catch (e) {
    return errorResult(e);
  }
}

export async function signupAction(input: unknown) {
  try {
    return await startSession(await signup(input as Parameters<typeof signup>[0]));
  } catch (e) {
    return errorResult(e);
  }
}

export async function forgotPasswordAction(input: { email: string }): Promise<ActionResult> {
  try {
    await requestPasswordReset(input);
    return { ok: true, data: null };
  } catch (e) {
    return errorResult(e);
  }
}

export async function resetPasswordAction(input: { token: string; password: string }) {
  try {
    return await startSession(await resetPassword(input));
  } catch (e) {
    return errorResult(e);
  }
}
