import "server-only";
import { ApiKey, Tenant } from "../models/core";
import { guard, tf } from "./guard";
import { runMutation } from "../mutation";
import { connectDb } from "../db";
import { sha256, randomToken } from "../auth/password";
import type { Ctx, TenantCtx } from "../context";

export interface ApiKeyInfo {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export async function getApiKeyInfo(ctx: Ctx | null): Promise<ApiKeyInfo | null> {
  const c = await guard(ctx, ["OWNER"]);
  const k = await ApiKey.findOne({ ...tf(c), revokedAt: null }).sort({ createdAt: -1 }).lean();
  return k ? { prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null } : null;
}

/** Creates a new key and revokes the old one. The plain key is returned ONCE; only its SHA-256 hash is stored. */
export async function rotateApiKey(ctx: Ctx | null, idempotencyKey?: string): Promise<{ key: string; info: ApiKeyInfo }> {
  const c = await guard(ctx, ["OWNER"]);
  return runMutation(c, { action: "apikey.rotate", entity: "apiKey", idempotencyKey }, async (session) => {
    await ApiKey.updateMany({ ...tf(c), revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
    const key = `bbk_${randomToken(30)}`;
    const prefix = key.slice(0, 12);
    const [doc] = await ApiKey.create([{ ...tf(c), prefix, keyHash: sha256(key), createdBy: c.userId }], { session });
    return { result: { key, info: { prefix, createdAt: doc.createdAt.toISOString(), lastUsedAt: null } }, entityId: String(doc._id), audit: { prefix } };
  });
}

export async function revokeApiKey(ctx: Ctx | null, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  return runMutation(c, { action: "apikey.revoke", entity: "apiKey", idempotencyKey }, async (session) => {
    await ApiKey.updateMany({ ...tf(c), revokedAt: null }, { $set: { revokedAt: new Date() } }, { session });
    return { result: null };
  });
}

/**
 * Pre-auth: turns an API key into a machine context for its tenant (no user).
 * Returns null for unknown or revoked keys.
 */
export async function ctxFromApiKey(key: string | null | undefined): Promise<TenantCtx | null> {
  if (!key || !key.startsWith("bbk_") || key.length > 200) return null;
  await connectDb();
  const k = await ApiKey.findOneAndUpdate({ keyHash: sha256(key), revokedAt: null }, { $set: { lastUsedAt: new Date() } }).lean();
  if (!k) return null;
  const t = await Tenant.findById(k.tenantId, { status: 1 }).lean();
  if (!t) return null;
  return {
    userId: "", // machine caller: movements and audit entries get userId null
    role: "OWNER", // tenant-wide scope; only applySale is reachable with this context
    tenantId: String(k.tenantId),
    locationIds: [],
    tenantStatus: t.status,
    name: `API key ${k.prefix}`,
    email: "",
  };
}
