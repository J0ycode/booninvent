/**
 * Seeds demo data with a login for every role. Safe to re-run: it removes and recreates the demo shops.
 * Usage: pnpm seed
 */
import mongoose, { type Types } from "mongoose";
import { connectDb, disconnectDb } from "@/server/db";
import { Tenant, Location, User } from "@/server/models/core";
import { hashPassword } from "@/server/auth/password";
import { seedCatalogAndStock } from "./seed-data";
import type { Role } from "@/lib/roles";

export const DEMO_PASSWORD = "Demo@12345";
const DEMO_SLUGS = ["demo-baby-shop", "other-baby-shop"];
const TENANT_COLLECTIONS = [
  "locations",
  "users",
  "suppliers",
  "products",
  "productcosts",
  "stocklevels",
  "stockmovements",
  "receipts",
  "dispatches",
  "restockrequests",
  "returndamageentries",
  "sales",
  "bills",
  "labelprintlogs",
  "auditlogs",
  "apikeys",
  "counters",
];

async function wipeDemo() {
  const tenants = await Tenant.find({ slug: { $in: DEMO_SLUGS } }).lean();
  const ids = tenants.map((t) => t._id);
  if (!ids.length) return;
  const db = mongoose.connection.db!;
  // Raw driver deletes: bypasses the append-only guard on stockMovements, for demo data only.
  for (const c of TENANT_COLLECTIONS) await db.collection(c).deleteMany({ tenantId: { $in: ids } });
  await Tenant.deleteMany({ _id: { $in: ids } });
}

async function makeTenant(name: string, slug: string, stores: string[]) {
  const tenant = await Tenant.create({ name, slug, company: { phone: "+91 98765 43210", address: "12 MG Road, Bengaluru" } });
  const storeRoom = await Location.create({ tenantId: tenant._id, name: "Store Room", type: "STORE_ROOM" });
  const storeDocs = [];
  for (const s of stores) storeDocs.push(await Location.create({ tenantId: tenant._id, name: s, type: "STORE" }));
  return { tenant, storeRoom, stores: storeDocs };
}

async function main() {
  await connectDb();
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()));
  await wipeDemo();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const demo = await makeTenant("Demo Baby Shop", "demo-baby-shop", ["Store A", "Store B"]);
  const other = await makeTenant("Other Baby Shop", "other-baby-shop", ["Main Store"]);

  const users: { email: string; name: string; role: Role; tenantId: Types.ObjectId; locationIds: Types.ObjectId[] }[] = [
    { email: "owner@demo.test", name: "Priya Owner", role: "OWNER", tenantId: demo.tenant._id, locationIds: [] },
    { email: "storeroom@demo.test", name: "Ravi Storeroom", role: "STOREROOM_MANAGER", tenantId: demo.tenant._id, locationIds: [] },
    { email: "storea@demo.test", name: "Anita Store A", role: "STORE_STAFF", tenantId: demo.tenant._id, locationIds: [demo.stores[0]._id] },
    { email: "storeb@demo.test", name: "Bala Store B", role: "STORE_STAFF", tenantId: demo.tenant._id, locationIds: [demo.stores[1]._id] },
    { email: "owner@other.test", name: "Other Owner", role: "OWNER", tenantId: other.tenant._id, locationIds: [] },
  ];
  for (const u of users) {
    await User.deleteOne({ email: u.email });
    await User.create({ ...u, passwordHash });
  }
  await User.updateOne(
    { email: "admin@demo.test" },
    { $set: { name: "Platform Admin", role: "PLATFORM_ADMIN", tenantId: null, passwordHash, active: true, locationIds: [] } },
    { upsert: true },
  );

  await seedCatalogAndStock(demo);

  console.log("\nDemo data ready. Password for every account:", DEMO_PASSWORD);
  console.table([
    { role: "PLATFORM_ADMIN", email: "admin@demo.test" },
    ...users.map((u) => ({ role: u.role, email: u.email })),
  ]);
  await disconnectDb();
}

main().catch(async (e) => {
  console.error(e);
  await disconnectDb();
  process.exit(1);
});
