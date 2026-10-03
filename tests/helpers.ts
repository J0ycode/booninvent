import { Tenant, Location, User } from "@/server/models/core";
import type { Ctx, TenantCtx } from "@/server/context";
import type { Role } from "@/lib/roles";

export interface TestShop {
  tenantId: string;
  storeRoomId: string;
  storeAId: string;
  storeBId: string;
  owner: TenantCtx;
  manager: TenantCtx;
  staffA: TenantCtx;
  staffB: TenantCtx;
}

let n = 0;

async function user(tenantId: string, role: Role, locationIds: string[] = []): Promise<TenantCtx> {
  n++;
  const u = await User.create({ tenantId, email: `u${n}-${Date.now()}@t.test`, name: `User ${n}`, role, locationIds, passwordHash: "x" });
  return { userId: String(u._id), role, tenantId, locationIds, tenantStatus: "ACTIVE", name: u.name, email: u.email };
}

/** A shop with Store Room, Store A, Store B and one user per role. */
export async function makeShop(name = "Shop"): Promise<TestShop> {
  n++;
  const t = await Tenant.create({ name, slug: `${name.toLowerCase().replace(/\W/g, "-")}-${n}-${Date.now()}` });
  const tenantId = String(t._id);
  const [sr, a, b] = await Location.create(
    [
      { tenantId, name: "Store Room", type: "STORE_ROOM" },
      { tenantId, name: "Store A", type: "STORE" },
      { tenantId, name: "Store B", type: "STORE" },
    ],
    { ordered: true },
  );
  return {
    tenantId,
    storeRoomId: String(sr._id),
    storeAId: String(a._id),
    storeBId: String(b._id),
    owner: await user(tenantId, "OWNER"),
    manager: await user(tenantId, "STOREROOM_MANAGER"),
    staffA: await user(tenantId, "STORE_STAFF", [String(a._id)]),
    staffB: await user(tenantId, "STORE_STAFF", [String(b._id)]),
  };
}

export async function platformAdmin(): Promise<Ctx> {
  const u = await User.create({ tenantId: null, email: `admin${Date.now()}@t.test`, name: "Admin", role: "PLATFORM_ADMIN", passwordHash: "x" });
  return { userId: String(u._id), role: "PLATFORM_ADMIN", tenantId: null, locationIds: [], tenantStatus: null, name: "Admin", email: u.email };
}

export const suspended = (c: TenantCtx): TenantCtx => ({ ...c, tenantStatus: "SUSPENDED" });

/** Expect a promise to reject with an AppError code. */
export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== code) throw new Error(`Expected error ${code} but got ${got ?? (e as Error).message}`);
    return;
  }
  throw new Error(`Expected error ${code} but the call succeeded`);
}
