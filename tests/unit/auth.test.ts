import { describe, it, expect } from "vitest";
import { signup, login, requestPasswordReset, resetPassword } from "@/server/data/auth";
import { ctxFromToken } from "@/server/context";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { authTokens, users, locations } from "@/server/db/schema";
import { sha256 } from "@/server/auth/password";
import { updateUser } from "@/server/data/users";
import { expectCode } from "../helpers";

const owner = { shopName: "Tiny Tots", ownerName: "Meera", email: "meera@tt.test", password: "secret123", storeName: "Store A" };

describe("auth", () => {
  it("signup creates tenant, Store Room, first Store and OWNER; login works", async () => {
    const s = await signup(owner);
    expect(s.role).toBe("OWNER");
    const ctx = await ctxFromToken(s.token);
    expect(ctx?.role).toBe("OWNER");
    const db = await getDb();
    const locs = await db.select().from(locations).where(eq(locations.tenantId, ctx!.tenantId!));
    expect(locs.map((l) => l.type).sort()).toEqual(["STORE", "STORE_ROOM"]);
    const l = await login({ email: owner.email, password: owner.password }, "1.1.1.1");
    expect((await ctxFromToken(l.token))?.userId).toBe(ctx!.userId);
  });

  it("rejects wrong password and duplicate signup", async () => {
    await signup(owner);
    await expectCode(login({ email: owner.email, password: "wrong-pass" }, "1.1.1.1"), "UNAUTHENTICATED");
    await expectCode(signup(owner), "CONFLICT");
  });

  it("rate limits repeated failed logins", async () => {
    await signup(owner);
    for (let i = 0; i < 5; i++) await login({ email: owner.email, password: "bad" }, "2.2.2.2").catch(() => {});
    await expectCode(login({ email: owner.email, password: owner.password }, "2.2.2.2"), "RATE_LIMITED");
  });

  it("password reset sets a new password and revokes old sessions", async () => {
    const s = await signup(owner);
    await requestPasswordReset({ email: owner.email });
    const db = await getDb();
    const [tok] = await db.select().from(authTokens).where(eq(authTokens.type, "RESET"));
    expect(tok).toBeTruthy();
    // Only the hash is stored; swap in a known token to simulate clicking the emailed link.
    await db.update(authTokens).set({ tokenHash: sha256("known-token-123") }).where(eq(authTokens.id, tok.id));
    const r = await resetPassword({ token: "known-token-123", password: "newpass123" });
    expect(await ctxFromToken(s.token)).toBeNull();
    expect(await ctxFromToken(r.token)).not.toBeNull();
    await expectCode(resetPassword({ token: "known-token-123", password: "again1234" }), "VALIDATION");
  });

  it("deactivating a user bumps their session version (signs them out)", async () => {
    const s = await signup(owner);
    const ctx = (await ctxFromToken(s.token))!;
    const db = await getDb();
    const [staff] = await db.insert(users).values({ tenantId: ctx.tenantId, email: "st@tt.test", name: "St", role: "STOREROOM_MANAGER", passwordHash: "x" }).returning();
    await updateUser(ctx, staff.id, { role: "STOREROOM_MANAGER", active: false });
    const [after] = await db.select().from(users).where(eq(users.id, staff.id));
    expect(after.active).toBe(false);
    expect(after.sessionVersion).toBe(2);
  });

  it("garbage or missing tokens give no context", async () => {
    expect(await ctxFromToken(undefined)).toBeNull();
    expect(await ctxFromToken("not-a-jwt")).toBeNull();
  });
});
