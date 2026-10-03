import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connectDb } from "./db";
import { User, Tenant } from "./models/core";
import { SESSION_COOKIE, verifySession } from "./auth/session";
import { resolveTenantId } from "./tenancy";
import { AppError } from "./errors";
import { PORTAL_BY_ROLE, type Role } from "@/lib/roles";

/** Authenticated request context. Every data-layer function requires one. */
export interface Ctx {
  userId: string;
  role: Role;
  tenantId: string | null;
  locationIds: string[];
  tenantStatus: "ACTIVE" | "SUSPENDED" | null;
  name: string;
  email: string;
}
export interface TenantCtx extends Ctx {
  tenantId: string;
}

export async function ctxFromToken(token: string | undefined, host?: string | null): Promise<Ctx | null> {
  const s = await verifySession(token);
  if (!s) return null;
  await connectDb();
  const user = await User.findById(s.sub).lean();
  if (!user || !user.active || user.sessionVersion !== s.sv || user.role !== s.role) return null;
  const tenantId = resolveTenantId(user, host);
  let tenantStatus: Ctx["tenantStatus"] = null;
  if (tenantId) {
    const t = await Tenant.findById(tenantId, { status: 1 }).lean();
    if (!t) return null;
    tenantStatus = t.status;
  }
  return {
    userId: String(user._id),
    role: user.role,
    tenantId,
    locationIds: (user.locationIds ?? []).map(String),
    tenantStatus,
    name: user.name,
    email: user.email,
  };
}

/** Context for server components / server actions (reads the session cookie). */
export async function getCtx(): Promise<Ctx | null> {
  const jar = await cookies();
  const h = await headers();
  return ctxFromToken(jar.get(SESSION_COOKIE)?.value, h.get("host"));
}

/** Context for route handlers. */
export async function ctxFromRequest(req: Request): Promise<Ctx | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\s*)${SESSION_COOKIE}=([^;]+)`));
  return ctxFromToken(m ? decodeURIComponent(m[1]) : undefined, req.headers.get("host"));
}

/** Throwing guard for actions and route handlers. */
export function requireRole<R extends Role>(ctx: Ctx | null, roles: readonly R[]): Ctx & { role: R } {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  if (!roles.includes(ctx.role as R)) throw new AppError("FORBIDDEN", "You do not have access to this.");
  return ctx as Ctx & { role: R };
}

export function requireTenant(ctx: Ctx | null, roles: readonly Role[]): TenantCtx {
  const c = requireRole(ctx, roles);
  if (!c.tenantId) throw new AppError("FORBIDDEN", "You do not have access to this.");
  return c as TenantCtx;
}

export async function requireActionCtx(roles: readonly Role[]): Promise<TenantCtx> {
  return requireTenant(await getCtx(), roles);
}

/** For server-component pages: redirect instead of throwing. */
export async function requirePageCtx(role: Role): Promise<Ctx> {
  const ctx = await getCtx();
  // Stale or revoked session: clear the cookie (avoids a redirect loop with proxy.ts).
  if (!ctx) redirect("/logout");
  if (ctx.role !== role) redirect(PORTAL_BY_ROLE[ctx.role]);
  return ctx;
}
