import "server-only";
import { z } from "zod";
import { connectDb, withTransaction } from "../db";
import { User, Tenant, Location, AuthToken, LoginAttempt } from "../models/core";
import { hashPassword, verifyPassword, sha256, randomToken } from "../auth/password";
import { signSession } from "../auth/session";
import { AppError, isDuplicateKey } from "../errors";
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

async function hit(key: string, _max?: number) {
  const now = new Date();
  const doc = await LoginAttempt.findOneAndUpdate(
    { key, expiresAt: { $gt: now } },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + WINDOW_MS) } },
    { upsert: true, returnDocument: "after" },
  ).catch(async (e) => {
    // An expired doc with the same key may still exist until the TTL monitor runs.
    if (!isDuplicateKey(e)) throw e;
    await LoginAttempt.deleteOne({ key, expiresAt: { $lte: now } });
    return LoginAttempt.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date(now.getTime() + WINDOW_MS) } },
      { upsert: true, returnDocument: "after" },
    );
  });
  return doc?.count ?? 0;
}

const LIMITED = () => new AppError("RATE_LIMITED", "Too many attempts. Please wait 15 minutes and try again.");

/** True when this key already used up its attempts in the current window. */
async function isLimited(key: string, max: number) {
  const doc = await LoginAttempt.findOne({ key, expiresAt: { $gt: new Date() } }).lean();
  return !!doc && doc.count >= max;
}

export interface LoginResult {
  token: string;
  role: Role;
}

export async function login(input: { email: string; password: string }, ip: string): Promise<LoginResult> {
  const { email, password } = z.object({ email: emailSchema, password: z.string().min(1) }).parse(input);
  await connectDb();
  // Only failed attempts count, so a shop sharing one IP is not locked out by normal use.
  if ((await isLimited(`ip:${ip}`, MAX_PER_IP)) || (await isLimited(`email:${email}`, MAX_PER_EMAIL))) throw LIMITED();
  const user = await User.findOne({ email });
  const ok = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !ok || !user.active) {
    await hit(`ip:${ip}`, MAX_PER_IP);
    await hit(`email:${email}`, MAX_PER_EMAIL);
    throw new AppError("UNAUTHENTICATED", "Email or password is incorrect.");
  }
  await LoginAttempt.deleteOne({ key: `email:${email}` });
  user.lastLoginAt = new Date();
  await user.save();
  await writeAudit({ tenantId: user.tenantId ? String(user.tenantId) : null, userId: String(user._id) }, "auth.login", "user", String(user._id));
  return { token: await signSession({ sub: String(user._id), role: user.role, sv: user.sessionVersion }), role: user.role };
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
  await connectDb();
  if (await User.exists({ email: data.email })) {
    throw new AppError("CONFLICT", "An account with this email already exists. Try signing in.");
  }
  const passwordHash = await hashPassword(data.password);
  const base = slugify(data.shopName);
  const user = await withTransaction(async (session) => {
    let slug = base;
    for (let i = 0; await Tenant.exists({ slug }).session(session); i++) slug = `${base}-${randomToken(3).toLowerCase()}`;
    const [tenant] = await Tenant.create([{ name: data.shopName, slug, company: { email: data.email } }], { session });
    await Location.create(
      [
        { tenantId: tenant._id, name: "Store Room", type: "STORE_ROOM" },
        { tenantId: tenant._id, name: data.storeName, type: "STORE" },
      ],
      { session, ordered: true },
    );
    const [u] = await User.create(
      [{ tenantId: tenant._id, email: data.email, name: data.ownerName, passwordHash, role: "OWNER" }],
      { session },
    );
    await writeAudit({ tenantId: String(tenant._id), userId: String(u._id) }, "tenant.signup", "tenant", String(tenant._id), { name: data.shopName }, session);
    return u;
  });
  return { token: await signSession({ sub: String(user._id), role: "OWNER", sv: user.sessionVersion }), role: "OWNER" };
}

/** Always succeeds from the caller's point of view, so it cannot be used to discover emails. */
export async function requestPasswordReset(input: { email: string }): Promise<void> {
  const parsed = emailSchema.safeParse(input.email);
  if (!parsed.success) return;
  await connectDb();
  if ((await hit(`reset:${parsed.data}`, MAX_PER_EMAIL)) > MAX_PER_EMAIL) throw LIMITED();
  const user = await User.findOne({ email: parsed.data, active: true });
  if (!user) return;
  const token = randomToken();
  await AuthToken.create({ userId: user._id, type: "RESET", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) });
  await sendEmail(
    user.email,
    "Reset your password",
    `Hello ${user.name},\n\nUse this link to set a new password for ${brand.name}. It expires in 1 hour.\n\n${env.appUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
  );
}

/** Creates an invite token and emails it. Used by the users data layer. */
export async function sendInvite(userId: string, email: string, name: string, shopName: string) {
  const token = randomToken();
  await AuthToken.create({ userId, type: "INVITE", tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) });
  await sendEmail(
    email,
    `You're invited to ${shopName}`,
    `Hello ${name},\n\nYou have been invited to ${shopName} on ${brand.name}. Set your password here (valid for 7 days):\n\n${env.appUrl}/reset-password?token=${token}&invite=1\n`,
  );
}

/** Sets a new password from a reset or invite token. Signs out other sessions. */
export async function resetPassword(input: { token: string; password: string }): Promise<LoginResult> {
  const { token, password } = z.object({ token: z.string().min(10), password: passwordSchema }).parse(input);
  await connectDb();
  const passwordHash = await hashPassword(password);
  const user = await withTransaction(async (session) => {
    const t = await AuthToken.findOneAndUpdate(
      { tokenHash: sha256(token), usedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { usedAt: new Date() } },
      { session },
    );
    if (!t) throw new AppError("VALIDATION", "This link has expired or was already used. Please request a new one.");
    const u = await User.findOneAndUpdate(
      { _id: t.userId, active: true },
      { $set: { passwordHash }, $inc: { sessionVersion: 1 } },
      { session, returnDocument: "after" },
    );
    if (!u) throw new AppError("VALIDATION", "This account is no longer active.");
    await writeAudit({ tenantId: u.tenantId ? String(u.tenantId) : null, userId: String(u._id) }, t.type === "INVITE" ? "auth.invite_accepted" : "auth.password_reset", "user", String(u._id), undefined, session);
    return u;
  });
  return { token: await signSession({ sub: String(user._id), role: user.role, sv: user.sessionVersion }), role: user.role };
}
