import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, tenants } from "../db/schema";
import { guard, tf } from "./guard";
import { runMutation } from "../mutation";
import { sha256, randomToken } from "../auth/password";
import type { Ctx, TenantCtx } from "../context";

export interface ApiKeyInfo {
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const active = (c: TenantCtx) => and(eq(apiKeys.tenantId, c.tenantId), isNull(apiKeys.revokedAt));

export async function getApiKeyInfo(ctx: Ctx | null): Promise<ApiKeyInfo | null> {
  const c = await guard(ctx, ["OWNER"]);
  const db = await getDb();
  const [k] = await db.select().from(apiKeys).where(active(c)).orderBy(desc(apiKeys.createdAt)).limit(1);
  return k ? { prefix: k.prefix, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null } : null;
}

/** Creates a new key and revokes the old one. The plain key is returned ONCE; only its SHA-256 hash is stored. */
export async function rotateApiKey(ctx: Ctx | null, idempotencyKey?: string): Promise<{ key: string; info: ApiKeyInfo }> {
  const c = await guard(ctx, ["OWNER"]);
  return runMutation(c, { action: "apikey.rotate", entity: "apiKey", idempotencyKey }, async (tx) => {
    await tx.update(apiKeys).set({ revokedAt: new Date() }).where(active(c));
    const key = `bbk_${randomToken(30)}`;
    const prefix = key.slice(0, 12);
    const [row] = await tx
      .insert(apiKeys)
      .values({ ...tf(c), prefix, keyHash: sha256(key), createdBy: c.userId })
      .returning();
    return { result: { key, info: { prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: null } }, entityId: row.id, audit: { prefix } };
  });
}

export async function revokeApiKey(ctx: Ctx | null, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  return runMutation(c, { action: "apikey.revoke", entity: "apiKey", idempotencyKey }, async (tx) => {
    await tx.update(apiKeys).set({ revokedAt: new Date() }).where(active(c));
    return { result: null };
  });
}

/**
 * Pre-auth: turns an API key into a machine context for its tenant (no user).
 * Returns null for unknown or revoked keys.
 */
export async function ctxFromApiKey(key: string | null | undefined): Promise<TenantCtx | null> {
  if (!key || !key.startsWith("bbk_") || key.length > 200) return null;
  const db = await getDb();
  const [k] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.keyHash, sha256(key)), isNull(apiKeys.revokedAt)))
    .returning({ tenantId: apiKeys.tenantId, prefix: apiKeys.prefix });
  if (!k) return null;
  const [t] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, k.tenantId));
  if (!t) return null;
  return {
    userId: "", // machine caller: movements and audit entries get userId null
    role: "OWNER", // tenant-wide scope; only applySale is reachable with this context
    tenantId: k.tenantId,
    locationIds: [],
    tenantStatus: t.status,
    name: `API key ${k.prefix}`,
    email: "",
  };
}
