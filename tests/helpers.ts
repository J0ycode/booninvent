import { count, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { getDb } from "@/server/db";
import { tenants, locations, users } from "@/server/db/schema";
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
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId, email: `u${n}-${Date.now()}@t.test`, name: `User ${n}`, role, locationIds, passwordHash: "x" })
    .returning();
  return { userId: u.id, role, tenantId, locationIds, tenantStatus: "ACTIVE", name: u.name, email: u.email };
}

/** A shop with Store Room, Store A, Store B and one user per role. */
export async function makeShop(name = "Shop"): Promise<TestShop> {
  n++;
  const db = await getDb();
  const [t] = await db
    .insert(tenants)
    .values({ name, slug: `${name.toLowerCase().replace(/\W/g, "-")}-${n}-${Date.now()}` })
    .returning({ id: tenants.id });
  const tenantId = t.id;
  const loc = async (locName: string, type: "STORE_ROOM" | "STORE") => {
    const [l] = await db.insert(locations).values({ tenantId, name: locName, type }).returning({ id: locations.id });
    return l.id;
  };
  const storeRoomId = await loc("Store Room", "STORE_ROOM");
  const storeAId = await loc("Store A", "STORE");
  const storeBId = await loc("Store B", "STORE");
  return {
    tenantId,
    storeRoomId,
    storeAId,
    storeBId,
    owner: await user(tenantId, "OWNER"),
    manager: await user(tenantId, "STOREROOM_MANAGER"),
    staffA: await user(tenantId, "STORE_STAFF", [storeAId]),
    staffB: await user(tenantId, "STORE_STAFF", [storeBId]),
  };
}

export async function platformAdmin(): Promise<Ctx> {
  const db = await getDb();
  const [u] = await db
    .insert(users)
    .values({ tenantId: null, email: `admin${Date.now()}-${++n}@t.test`, name: "Admin", role: "PLATFORM_ADMIN", passwordHash: "x" })
    .returning();
  return { userId: u.id, role: "PLATFORM_ADMIN", tenantId: null, locationIds: [], tenantStatus: null, name: "Admin", email: u.email };
}

export const suspended = (c: TenantCtx): TenantCtx => ({ ...c, tenantStatus: "SUSPENDED" });

/** Number of rows in a table that match (direct database check, tests only). */
export async function rowCount(table: PgTable, where?: SQL): Promise<number> {
  const db = await getDb();
  const [r] = await db.select({ n: count() }).from(table).where(where);
  return r.n;
}

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

/** Expect a database statement to fail with a message matching `pattern` (looks through the ORM's wrapped error). */
export async function expectDbError(p: PromiseLike<unknown>, pattern: RegExp) {
  try {
    await p;
  } catch (e) {
    for (let cur: unknown = e; cur; cur = (cur as { cause?: unknown }).cause) {
      if (pattern.test(String((cur as Error).message ?? cur))) return;
    }
    throw new Error(`Expected a database error matching ${pattern} but got: ${(e as Error).message}`);
  }
  throw new Error(`Expected a database error matching ${pattern} but the statement succeeded`);
}
