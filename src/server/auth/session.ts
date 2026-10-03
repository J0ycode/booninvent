import { SignJWT, jwtVerify } from "jose";
import type { Role } from "@/lib/roles";

/*
 * Session token helpers. Kept free of "server-only"/DB imports so proxy.ts can use them.
 * The token is only a pointer: getCtx() re-checks the user in the database on every request.
 */

export const SESSION_COOKIE = "bb_session";
export const SESSION_MAX_AGE = 60 * 60 * 12; // 12 hours

export interface SessionPayload {
  sub: string; // userId
  role: Role;
  sv: number; // sessionVersion, bumped on password change / deactivation
}

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars).");
  return new TextEncoder().encode(s);
}

export async function signSession(p: SessionPayload): Promise<string> {
  return new SignJWT({ role: p.role, sv: p.sv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(p.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(key());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { sub: payload.sub, role: payload.role as Role, sv: Number(payload.sv) };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
