import "server-only";
import { z } from "zod";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb, withTransaction } from "../db";
import { users, tenants, locations, authTokens, loginAttempts } from "../db/schema";
import { hashPassword, verifyPassword, sha256, randomToken } from "../auth/password";
import { signSession } from "../auth/session";
import { AppError } from "../errors";
import { writeAudit } from "../audit";
import { sendEmail } from "../email";
import { env } from "../env";
import { brand } from "@/config/brand";
import type { Role } from "@/lib/roles";
import { emailSchema, passwordSchema } from "@/lib/validation";

/*
 * Pre-authentication functions (login, signup, password reset, invite acceptance).
 * These are the only data functions that do not take a Ctx, because no user is signed in yet.
 */

const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 30;
const WINDOW_MS = 15 * 60 * 1000;

/** Counts one attempt for this key. An expired window starts again at 1. Returns the new count. */
async function hit(key: string): Promise<number> {
  const db = await getDb();
  const expiresAt = new Date(Date.now() + WINDOW_MS);
  const [row] = await db
    .insert(loginAttempts)
    .values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        count: sql`case when ${loginAttempts.expiresAt} <= now() then 1 else ${loginAttempts.count} + 1 end`,
        expiresAt: sql`case when ${loginAttempts.expiresAt} <= now() then excluded.expires_at else ${loginAttempts.expiresAt} end`,
      },
    })
    .returning({ count: loginAttempts.count });
  return row.count;
}

const LIMITED = () => new AppError("RATE_LIMITED", "Too many attempts. Please wait 15 minutes and try again.");

/** True when this key already used up its attempts in the current window. */
async function isLimited(key: string, max: number) {
  const db = await getDb();
  const [row] = await db
    .select({ count: loginAttempts.count })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.expiresAt, new Date())));
  return !!row && row.count >= max;
}

export interface LoginResult {
  token: string;
  role: Role;
}

export async function login(input: { email: string; password: string }, ip: string): Promise<LoginResult> {
  const { email, password } = z.object({ email: emailSchema, password: z.string().min(1) }).parse(input);
  const db = await getDb();
  // Only failed attempts count, so a shop sharing one IP is not locked out by normal use.
  if ((await isLimited(`ip:${ip}`, MAX_PER_IP)) || (await isLimited(`email:${email}`, MAX_PER_EMAIL))) throw LIMITED();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok || !user.active) {
    await hit(`ip:${ip}`);
    await hit(`email:${email}`);
    throw new AppError("UNAUTHENTICATED", "Email or password is incorrect.");
  }
  await db.delete(loginAttempts).where(eq(loginAttempts.key, `email:${email}`));
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await writeAudit({ tenantId: user.tenantId, userId: user.id }, "auth.login", "user", user.id);
  return { token: await signSession({ sub: user.id, role: user.role, sv: user.sessionVersion }), role: user.role };
}

export const signupSchema = z.object({
  shopName: z.string().trim().min(2, "Enter the shop name").max(80),
  ownerName: z.string().trim().min(2, "Enter your name").max(80),
  email: emailSchema,
  password: passwordSchema,
  storeName: z.string().trim().min(2, "Enter the first store's name").max(60),
});

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "shop"
  );
}

/** Creates the tenant, its Store Room, the first Store and the OWNER user. */
export async function signup(input: z.input<typeof signupSchema>): Promise<LoginResult> {
  const data = signupSchema.parse(input);
  const db = await getDb();
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.email, data.email));
  if (exists) throw new AppError("CONFLICT", "An account with this email already exists. Try signing in.");
  const passwordHash = await hashPassword(data.password);
  const base = slugify(data.shopName);
  const user = await withTransaction(async (tx) => {
    let slug = base;
    for (;;) {
      const [taken] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
      if (!taken) break;
      slug = `${base}-${randomToken(3)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "x")}`;
    }
    const [tenant] = await tx
      .insert(tenants)
      .values({ name: data.shopName, slug, company: { email: data.email } })
      .returning();
    await tx.insert(locations).values([
      { tenantId: tenant.id, name: "Store Room", type: "STORE_ROOM" },
      { tenantId: tenant.id, name: data.storeName, type: "STORE" },
    ]);
    const [u] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: data.email, name: data.ownerName, passwordHash, role: "OWNER" })
      .returning();
    await writeAudit({ tenantId: tenant.id, userId: u.id }, "tenant.signup", "tenant", tenant.id, { name: data.shopName }, tx);
    return u;
  });
  return { token: await signSession({ sub: user.id, role: "OWNER", sv: user.sessionVersion }), role: "OWNER" };
}

/** Always succeeds from the caller's point of view, so it cannot be used to discover emails. */
export async function requestPasswordReset(input: { email: string }): Promise<void> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return;
  const db = await getDb();
  if ((await hit(`reset:${parsed.data}`)) > MAX_PER_EMAIL) throw LIMITED();
  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, parsed.data), eq(users.active, true)));
  if (!user) return;
  const token = randomToken();
  await db
    .insert(authTokens)
    .values({ userId: user.id, type: "RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  await sendEmail(
    user.email,
    "Reset your password",
    `Hello ${user.name},\n\nUse this link to set a new password for ${brand.name}. It expires in 1 hour.\n\n${env.appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
  );
}

/** Creates an invite token and emails it. Used by the users data layer. */
export async function sendInvite(userId: string, email: string, name: string, shopName: string) {
  const db = await getDb();
  const token = randomToken();
  await db
    .insert(authTokens)
    .values({ userId, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  await sendEmail(
    email,
    `You're invited to ${shopName}`,
    `Hello ${name},\n\nYou have been invited to ${shopName} on ${brand.name}. Set your password here (valid for 7 days):\n\n${env.appUrl}/reset-password?token=${token}&invite=1\n`,
  );
}

/** Sets a new password from a reset or invite token. Signs out other sessions. */
export async function resetPassword(input: { token: string; password: string }): Promise<LoginResult> {
  const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(input);
  const passwordHash = await hashPassword(password);
  const user = await withTransaction(async (tx) => {
    // Single use: the UPDATE only matches an unused, unexpired token.
    const [t] = await tx
      .update(authTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(authTokens.tokenHash, sha256(token)), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
      .returning();
    if (!t) throw new AppError("VALIDATION", "This link has expired or was already used. Please request a new one.");
    const [u] = await tx
      .update(users)
      .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(and(eq(users.id, t.userId), eq(users.active, true)))
      .returning();
    if (!u) throw new AppError("VALIDATION", "This account is no longer active.");
    await writeAudit(
      { tenantId: u.tenantId, userId: u.id },
      t.type === "INVITE" ? "auth.invite_accepted" : "auth.password_reset",
      "user",
      u.id,
      undefined,
      tx,
    );
    return u;
  });
  return { token: await signSession({ sub: user.id, role: user.role, sv: user.sessionVersion }), role: user.role };
}
