import "server-only";
import { connectDb } from "../db";
import { AppError } from "../errors";
import type { Ctx, TenantCtx } from "../context";
import type { Role } from "@/lib/roles";

/** Role check + tenant presence + DB connection. Call first in every data function. */
export async function guard(ctx: Ctx | null, roles: readonly Role[]): Promise<TenantCtx> {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  if (!roles.includes(ctx.role)) throw new AppError("FORBIDDEN", "You do not have access to this.");
  if (!ctx.tenantId) throw new AppError("FORBIDDEN", "You do not have access to this.");
  await connectDb();
  return ctx as TenantCtx;
}

export async function guardPlatform(ctx: Ctx | null): Promise<Ctx> {
  if (!ctx) throw new AppError("UNAUTHENTICATED", "Please sign in again.");
  if (ctx.role !== "PLATFORM_ADMIN") throw new AppError("FORBIDDEN", "You do not have access to this.");
  await connectDb();
  return ctx;
}

/** STORE_STAFF may only touch their own store. Other tenant roles may use any location of the tenant. */
export function assertLocationAccess(ctx: TenantCtx, locationId: string) {
  if (ctx.role === "STORE_STAFF" && !ctx.locationIds.includes(String(locationId))) {
    throw new AppError("FORBIDDEN", "You can only work with your own store.");
  }
}

/** The single store a STORE_STAFF user works in. */
export function staffLocationId(ctx: TenantCtx): string {
  const id = ctx.locationIds[0];
  if (!id) throw new AppError("FORBIDDEN", "Your account is not linked to a store. Ask the owner to fix this.");
  return id;
}

/** Base filter for every tenant query. tenantId always comes from ctx, never from input. */
export const tf = (ctx: TenantCtx) => ({ tenantId: ctx.tenantId });
