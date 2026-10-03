import "server-only";
import { z } from "zod";
import { AppError } from "./errors";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> };

/** Turns thrown errors into a friendly result for client forms. */
export async function toResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return errorResult(e);
  }
}

export function errorResult(e: unknown): { ok: false; error: string; code?: string; fieldErrors?: Record<string, string> } {
  if (e instanceof AppError) return { ok: false, error: e.message, code: e.code };
  if (e instanceof z.ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: e.issues[0]?.message ?? "Please check the form.", code: "VALIDATION", fieldErrors };
  }
  // Re-throw Next.js control-flow errors (redirect / notFound).
  if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
  console.error("[action error]", e);
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** JSON response for route handlers. */
export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) return Response.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  if (e instanceof z.ZodError) return Response.json({ error: { code: "VALIDATION", message: e.issues[0]?.message ?? "Invalid request", details: e.issues } }, { status: 400 });
  console.error("[route error]", e);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}
