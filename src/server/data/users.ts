import "server-only";
import { z } from "zod";
import { User, Location, Tenant, type UserDoc } from "../models/core";
import { guard, tf } from "./guard";
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
const view = (u: UserDoc): UserView => ({
  id: String(u._id),
  name: u.name,
  email: u.email,
  role: u.role,
  locationIds: (u.locationIds ?? []).map(String),
  active: u.active,
  invited: !u.passwordHash,
  lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
});

export async function listUsers(ctx: Ctx | null): Promise<UserView[]> {
  const c = await guard(ctx, ["OWNER"]);
  const rows = await User.find(tf(c)).sort({ name: 1 }).lean();
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
  const l = await Location.findOne({ tenantId, _id: locationId, type: "STORE" }).lean();
  if (!l) throw new AppError("VALIDATION", "Pick one of your stores.");
}

export async function inviteUser(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<UserView> {
  const c = await guard(ctx, ["OWNER"]);
  const data = inviteSchema.parse(input);
  if (data.role === "STORE_STAFF") await assertStore(c.tenantId, data.locationId!);
  const created = await runMutation(c, { action: "user.invite", entity: "user", idempotencyKey }, async (session) => {
    try {
      const [u] = await User.create(
        [
          {
            ...tf(c),
            name: data.name,
            email: data.email,
            role: data.role,
            locationIds: data.role === "STORE_STAFF" ? [data.locationId!] : [],
            passwordHash: null,
          },
        ],
        { session },
      );
      return { result: view(u.toObject()), entityId: String(u._id), audit: { email: data.email, role: data.role } };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", "Someone with this email already has an account.");
      throw e;
    }
  });
  const tenant = await Tenant.findById(c.tenantId).lean();
  await sendInvite(created.id, created.email, created.name, tenant?.name ?? "your shop");
  return created;
}

const updateSchema = z.object({
  role: z.enum(TENANT_ROLES),
  locationId: objectId.optional().or(z.literal("")),
  active: z.boolean(),
});

export async function updateUser(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<UserView> {
  const c = await guard(ctx, ["OWNER"]);
  const data = updateSchema.parse(input);
  if (id === c.userId && (data.role !== "OWNER" || !data.active)) {
    throw new AppError("VALIDATION", "You cannot remove your own owner access.");
  }
  if (data.role === "STORE_STAFF") {
    if (!data.locationId) throw new AppError("VALIDATION", "Pick the store for this person.");
    await assertStore(c.tenantId, data.locationId);
  }
  return runMutation(c, { action: "user.update", entity: "user", idempotencyKey }, async (session) => {
    const u = await User.findOneAndUpdate(
      { ...tf(c), _id: id },
      {
        $set: { role: data.role, active: data.active, locationIds: data.role === "STORE_STAFF" ? [data.locationId] : [] },
        $inc: { sessionVersion: 1 }, // force re-login with new permissions
      },
      { session, returnDocument: "after" },
    ).lean();
    if (!u) throw new AppError("NOT_FOUND", "User not found.");
    return { result: view(u), entityId: id, audit: data };
  });
}

export async function resendInvite(ctx: Ctx | null, id: string) {
  const c = await guard(ctx, ["OWNER"]);
  const u = await User.findOne({ ...tf(c), _id: id, passwordHash: null }).lean();
  if (!u) throw new AppError("NOT_FOUND", "This person has already set a password.");
  const tenant = await Tenant.findById(c.tenantId).lean();
  await sendInvite(String(u._id), u.email, u.name, tenant?.name ?? "your shop");
  return null;
}
