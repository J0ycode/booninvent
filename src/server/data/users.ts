import "server-only";
import { z } from "zod";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users, locations, tenants } from "../db/schema";
import { guard, tf, assertId } from "./guard";
import { runMutation } from "../mutation";
import { AppError, isDuplicateKey } from "../errors";
import { sendInvite } from "./auth";
import { emailSchema, objectId } from "@/lib/validation";
import { TENANT_ROLES, type Role } from "@/lib/roles";
import type { Ctx } from "../context";

export interface UserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  locationIds: string[];
  active: boolean;
  invited: boolean;
  lastLoginAt: string | null;
}
const view = (u: typeof users.$inferSelect): UserView => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  locationIds: u.locationIds ?? [],
  active: u.active,
  invited: !u.passwordHash,
  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});

export async function listUsers(ctx: Ctx | null): Promise<UserView[]> {
  const c = await guard(ctx, ["OWNER"]);
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.tenantId, c.tenantId)).orderBy(asc(users.name));
  return rows.map(view);
}

export const inviteSchema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").max(80),
    email: emailSchema,
    role: z.enum(TENANT_ROLES),
    locationId: objectId.optional().or(z.literal("")),
  })
  .refine((v) => v.role !== "STORE_STAFF" || !!v.locationId, { message: "Pick the store for this person", path: ["locationId"] });

async function assertStore(tenantId: string, locationId: string) {
  const db = await getDb();
  const [l] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(and(eq(locations.tenantId, tenantId), eq(locations.id, locationId), eq(locations.type, "STORE")));
  if (!l) throw new AppError("VALIDATION", "Pick one of your stores.");
}

async function shopName(tenantId: string) {
  const db = await getDb();
  const [t] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.name ?? "your shop";
}

export async function inviteUser(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<UserView> {
  const c = await guard(ctx, ["OWNER"]);
  const data = inviteSchema.parse(input);
  if (data.role === "STORE_STAFF") await assertStore(c.tenantId, data.locationId!);
  let created: UserView;
  try {
    created = await runMutation(c, { action: "user.invite", entity: "user", idempotencyKey }, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          ...tf(c),
          name: data.name,
          email: data.email,
          role: data.role,
          locationIds: data.role === "STORE_STAFF" ? [data.locationId!] : [],
          passwordHash: null,
        })
        .returning();
      return { result: view(u), entityId: u.id, audit: { email: data.email, role: data.role } };
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError("CONFLICT", "Someone with this email already has an account.");
    throw e;
  }
  await sendInvite(created.id, created.email, created.name, await shopName(c.tenantId));
  return created;
}

const updateSchema = z.object({
  role: z.enum(TENANT_ROLES),
  locationId: objectId.optional().or(z.literal("")),
  active: z.boolean(),
});

export async function updateUser(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<UserView> {
  const c = await guard(ctx, ["OWNER"]);
  assertId(id, "User not found.");
  const data = updateSchema.parse(input);
  if (id === c.userId && (data.role !== "OWNER" || !data.active)) {
    throw new AppError("VALIDATION", "You cannot remove your own owner access.");
  }
  if (data.role === "STORE_STAFF") {
    if (!data.locationId) throw new AppError("VALIDATION", "Pick the store for this person.");
    await assertStore(c.tenantId, data.locationId);
  }
  return runMutation(c, { action: "user.update", entity: "user", idempotencyKey }, async (tx) => {
    const [u] = await tx
      .update(users)
      .set({
        role: data.role,
        active: data.active,
        locationIds: data.role === "STORE_STAFF" ? [data.locationId!] : [],
        sessionVersion: sql`${users.sessionVersion} + 1`, // force re-login with new permissions
      })
      .where(and(eq(users.tenantId, c.tenantId), eq(users.id, id)))
      .returning();
    if (!u) throw new AppError("NOT_FOUND", "User not found.");
    return { result: view(u), entityId: id, audit: data };
  });
}

export async function resendInvite(ctx: Ctx | null, id: string) {
  const c = await guard(ctx, ["OWNER"]);
  assertId(id, "This person has already set a password.");
  const db = await getDb();
  const [u] = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, c.tenantId), eq(users.id, id), isNull(users.passwordHash)));
  if (!u) throw new AppError("NOT_FOUND", "This person has already set a password.");
  await sendInvite(u.id, u.email, u.name, await shopName(c.tenantId));
  return null;
}
