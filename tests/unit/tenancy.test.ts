import { describe, it, expect } from "vitest";
import { makeShop, expectCode, platformAdmin } from "../helpers";
import { listUsers, inviteUser, updateUser } from "@/server/data/users";
import { listLocations, renameLocation, addStore } from "@/server/data/locations";
import { getMyTenant, updateCompany } from "@/server/data/tenant";

describe("tenant isolation (users, locations, tenant)", () => {
  it("a tenant only ever sees its own users and locations", async () => {
    const a = await makeShop("Alpha");
    const b = await makeShop("Beta");
    const users = await listUsers(a.owner);
    expect(users.length).toBe(4);
    const bIds = new Set([b.owner.userId, b.manager.userId, b.staffA.userId, b.staffB.userId]);
    expect(users.some((u) => bIds.has(u.id))).toBe(false);

    const locs = await listLocations(a.owner);
    expect(locs.map((l) => l.id).sort()).toEqual([a.storeRoomId, a.storeAId, a.storeBId].sort());
    expect((await getMyTenant(a.owner)).id).toBe(a.tenantId);
  });

  it("cannot rename or edit another tenant's records even with their ids", async () => {
    const a = await makeShop("Alpha");
    const b = await makeShop("Beta");
    await expectCode(renameLocation(a.owner, b.storeAId, { name: "Hacked" }), "NOT_FOUND");
    await expectCode(updateUser(a.owner, b.manager.userId, { role: "OWNER", active: true }), "NOT_FOUND");
    expect((await listLocations(b.owner)).find((l) => l.id === b.storeAId)?.name).toBe("Store A");
  });

  it("ignores any tenantId smuggled in the input", async () => {
    const a = await makeShop("Alpha");
    const b = await makeShop("Beta");
    await addStore(a.owner, { name: "Store C", tenantId: b.tenantId });
    expect((await listLocations(b.owner)).some((l) => l.name === "Store C")).toBe(false);
    expect((await listLocations(a.owner)).some((l) => l.name === "Store C")).toBe(true);
  });

  it("invite: STORE_STAFF must be linked to a store of the same tenant", async () => {
    const a = await makeShop("Alpha");
    const b = await makeShop("Beta");
    await expectCode(inviteUser(a.owner, { name: "X Y", email: "x@y.test", role: "STORE_STAFF", locationId: b.storeAId }), "VALIDATION");
    const ok = await inviteUser(a.owner, { name: "X Y", email: "x2@y.test", role: "STORE_STAFF", locationId: a.storeAId });
    expect(ok.invited).toBe(true);
  });
});

describe("roles", () => {
  it("rejects missing context and wrong roles", async () => {
    const a = await makeShop();
    await expectCode(listUsers(null), "UNAUTHENTICATED");
    await expectCode(listUsers(a.manager), "FORBIDDEN");
    await expectCode(listUsers(a.staffA), "FORBIDDEN");
    await expectCode(updateCompany(a.manager, { name: "X" }), "FORBIDDEN");
    await expectCode(addStore(a.staffA, { name: "X" }), "FORBIDDEN");
    await expectCode(listUsers(await platformAdmin()), "FORBIDDEN");
  });

  it("STORE_STAFF only sees their own store", async () => {
    const a = await makeShop();
    const locs = await listLocations(a.staffA);
    expect(locs.map((l) => l.id)).toEqual([a.storeAId]);
  });

  it("owner cannot remove their own owner access", async () => {
    const a = await makeShop();
    await expectCode(updateUser(a.owner, a.owner.userId, { role: "STORE_STAFF", locationId: a.storeAId, active: true }), "VALIDATION");
  });

  it("idempotency: the same key applies a write once", async () => {
    const a = await makeShop();
    const r1 = await addStore(a.owner, { name: "Store C" }, "key-1");
    const r2 = await addStore(a.owner, { name: "Store C" }, "key-1");
    expect(r2.id).toBe(r1.id);
    expect((await listLocations(a.owner)).filter((l) => l.name === "Store C").length).toBe(1);
  });
});
