/**
 * Seeds demo data with a login for every role. Safe to re-run: it removes and recreates the demo shops.
 * Usage: pnpm seed   (run `pnpm db:migrate` once first when DATABASE_URL points at Supabase)
 */
import { eq, inArray, sql } from "drizzle-orm";
import { getDb, disconnectDb, withTransaction } from "@/server/db";
import { tenants, locations, users, auditLogs } from "@/server/db/schema";
import { stockMovements } from "@/server/db/stock-schema";
import { hashPassword } from "@/server/auth/password";
import { seedCatalogAndStock, seedPlatformBills, type SeedTenant } from "./seed-data";
import type { Role } from "@/lib/roles";

export const DEMO_PASSWORD = "Demo@12345";
const DEMO_SLUGS = ["demo-baby-shop", "other-baby-shop"];

async function wipeDemo() {
  const db = await getDb();
  const rows = await db.select({ id: tenants.id }).from(tenants).where(inArray(tenants.slug, DEMO_SLUGS));
  const ids = rows.map((t) => t.id);
  if (!ids.length) return;
  await withTransaction(async (tx) => {
    // The ledger is append-only; this switch allows deletes for this one transaction (demo data only).
    await tx.execute(sql`set local app.allow_ledger_delete = 'on'`);
    await tx.delete(stockMovements).where(inArray(stockMovements.tenantId, ids));
    await tx.delete(auditLogs).where(inArray(auditLogs.tenantId, ids));
    // Every other tenant table is removed by ON DELETE CASCADE.
    await tx.delete(tenants).where(inArray(tenants.id, ids));
  });
}

async function makeTenant(name: string, slug: string, stores: string[]): Promise<SeedTenant> {
  const db = await getDb();
  const [tenant] = await db
    .insert(tenants)
    .values({ name, slug, company: { phone: "+91 98765 43210", address: "12 MG Road, Bengaluru" } })
    .returning({ id: tenants.id });
  const [storeRoom] = await db.insert(locations).values({ tenantId: tenant.id, name: "Store Room", type: "STORE_ROOM" }).returning({ id: locations.id });
  const storeRows: { id: string }[] = [];
  for (const s of stores) {
    const [row] = await db.insert(locations).values({ tenantId: tenant.id, name: s, type: "STORE" }).returning({ id: locations.id });
    storeRows.push(row);
  }
  return { tenant, storeRoom, stores: storeRows };
}

async function main() {
  const db = await getDb();
  await wipeDemo();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const demo = await makeTenant("Demo Baby Shop", "demo-baby-shop", ["Store A", "Store B"]);
  const other = await makeTenant("Other Baby Shop", "other-baby-shop", ["Main Store"]);

  const people: { email: string; name: string; role: Role; tenantId: string; locationIds: string[] }[] = [
    { email: "owner@demo.test", name: "Priya Owner", role: "OWNER", tenantId: demo.tenant.id, locationIds: [] },
    { email: "storeroom@demo.test", name: "Ravi Storeroom", role: "STOREROOM_MANAGER", tenantId: demo.tenant.id, locationIds: [] },
    { email: "storea@demo.test", name: "Anita Store A", role: "STORE_STAFF", tenantId: demo.tenant.id, locationIds: [demo.stores[0].id] },
    { email: "storeb@demo.test", name: "Bala Store B", role: "STORE_STAFF", tenantId: demo.tenant.id, locationIds: [demo.stores[1].id] },
    { email: "owner@other.test", name: "Other Owner", role: "OWNER", tenantId: other.tenant.id, locationIds: [] },
  ];
  for (const u of people) {
    await db.delete(users).where(eq(users.email, u.email));
    await db.insert(users).values({ ...u, passwordHash });
  }
  const admin = { name: "Platform Admin", role: "PLATFORM_ADMIN" as const, tenantId: null, passwordHash, active: true, locationIds: [] };
  await db
    .insert(users)
    .values({ email: "admin@demo.test", ...admin })
    .onConflictDoUpdate({ target: users.email, set: admin });

  await seedCatalogAndStock(demo);
  await seedPlatformBills(demo.tenant.id, other.tenant.id);

  console.log("\nDemo data ready. Password for every account:", DEMO_PASSWORD);
  console.table([{ role: "PLATFORM_ADMIN", email: "admin@demo.test" }, ...people.map((u) => ({ role: u.role, email: u.email }))]);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
