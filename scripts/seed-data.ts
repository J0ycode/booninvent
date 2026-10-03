import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import type { TenantCtx } from "@/server/context";
import { saveSupplier, listSuppliers } from "@/server/data/suppliers";
import { importProducts, listProducts } from "@/server/data/products";
import { receiveStock } from "@/server/stock/receipts";
import { saveDraft, sendDispatch, receiveDispatch } from "@/server/stock/dispatches";
import { createManualRequest } from "@/server/data/restock";
import { applySale } from "@/server/stock/sales";
import { createEntries } from "@/server/stock/returns";
import { saveSupplierBill, markSupplierBillPaid } from "@/server/data/bills";
import { isoDay } from "@/lib/format";

export interface SeedTenant {
  tenant: { id: string };
  storeRoom: { id: string };
  stores: { id: string }[];
}

export async function ctxFor(email: string): Promise<TenantCtx> {
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, email));
  if (!u || !u.tenantId) throw new Error(`Seed user ${email} missing`);
  return {
    userId: u.id,
    role: u.role,
    tenantId: u.tenantId,
    locationIds: u.locationIds,
    tenantStatus: "ACTIVE",
    name: u.name,
    email: u.email,
  };
}

const CLOTHING = ["Cotton Romper", "Onesie", "Frock", "Jhabla", "Sleepsuit", "Cap", "Mittens", "Booties", "Socks", "Dungaree", "Kurta Set", "Shorts Set"];
const SIZES = ["0-3M", "3-6M", "6-12M"];
const ACCESSORIES = [
  ["Baby Bib", 149],
  ["Feeding Bottle 250ml", 399],
  ["Rattle Toy", 249],
  ["Swaddle Blanket", 699],
  ["Hooded Towel", 549],
  ["Diaper Bag", 1499],
  ["Silicone Teether", 299],
  ["Pacifier", 199],
  ["Baby Comb Set", 179],
  ["Nail Clipper", 129],
  ["Muslin Wipes (5)", 349],
  ["Soft Hairband", 99],
] as const;

/** Demo suppliers and ~100 products. Phase 3+ extends this with stock and documents. */
export async function seedCatalogAndStock(_t: SeedTenant) {
  const manager = await ctxFor("storeroom@demo.test");
  const s1 = await saveSupplier(manager, null, { name: "Little Threads Pvt Ltd", phone: "+91 98450 11111", gstin: "29ABCDE1234F1Z5" });
  await saveSupplier(manager, null, { name: "Tiny Steps Accessories", phone: "+91 98450 22222" });

  const rows: Record<string, string>[] = [];
  CLOTHING.forEach((item, i) =>
    SIZES.forEach((size, j) =>
      rows.push({
        name: `${item} ${size}`,
        category: "Clothing",
        sellingPrice: String(299 + i * 50 + j * 30),
        costPrice: String(Math.round((299 + i * 50 + j * 30) * 0.55)),
        supplier: s1.name,
        reorderLevel: "5",
      }),
    ),
  );
  ACCESSORIES.forEach(([name, price]) =>
    rows.push({ name, category: "Accessory", sellingPrice: String(price), costPrice: String(Math.round(price * 0.5)), supplier: "Tiny Steps Accessories", reorderLevel: "8" }),
  );
  // A few extra colours so the list paginates.
  for (const colour of ["Pink", "Blue", "Yellow", "White", "Green"]) {
    for (const item of ["Cotton Romper", "Onesie", "Sleepsuit"]) {
      rows.push({ name: `${item} ${colour} 6-12M`, category: "Clothing", sellingPrice: "449", costPrice: "240", supplier: s1.name, reorderLevel: "4" });
    }
  }
  const res = await importProducts(manager, rows, true);
  if (res.errorCount) throw new Error(`Seed products invalid: ${JSON.stringify(res.results.filter((r) => r.errors.length).slice(0, 3))}`);
  console.log(`Seeded ${res.imported} products.`);

  // Phase 3: two supplier deliveries into the Store Room.
  const all = (await listProducts(manager, { pageSize: 100 })).rows;
  const clothing = all.filter((p) => p.category === "CLOTHING");
  const accessories = all.filter((p) => p.category === "ACCESSORY");
  await receiveStock(manager, {
    supplierId: s1.id,
    invoiceNumber: "LT-2041",
    lines: clothing.map((p, i) => ({ productId: p.id, quantity: 20 + (i % 5) * 4, cost: p.costPrice ?? null })),
  });
  const s2 = (await listSuppliers(manager)).find((x) => x.name === "Tiny Steps Accessories")!;
  await receiveStock(manager, {
    supplierId: s2.id,
    invoiceNumber: "TS-118",
    // Leave two accessories at zero so low stock shows up.
    lines: accessories.slice(2).map((p, i) => ({ productId: p.id, quantity: 12 + i * 3 })),
  });
  console.log("Seeded 2 receipts.");

  // Phase 4: dispatches to the stores.
  const storeA = _t.stores[0].id;
  const storeB = _t.stores[1].id;
  const staffA = await ctxFor("storea@demo.test");
  const staffB = await ctxFor("storeb@demo.test");
  const send = async (to: string, items: typeof clothing, n: number) =>
    sendDispatch(manager, (await saveDraft(manager, null, { toLocationId: to, lines: items.map((p) => ({ productId: p.id, quantity: n })) })).id);
  const full = (d: Awaited<ReturnType<typeof send>>) => ({ lines: d.lines.map((l) => ({ lineId: l.id, receivedQty: l.quantity, missingQty: 0, damagedQty: 0 })) });

  const d1 = await send(storeA, clothing.slice(0, 20), 6);
  await receiveDispatch(staffA, d1.id, full(d1));
  const d2 = await send(storeB, clothing.slice(10, 30), 5);
  await receiveDispatch(staffB, d2.id, full(d2));
  const d3 = await send(storeA, [...clothing.slice(20, 24), ...accessories.slice(2, 6)], 4);
  await receiveDispatch(staffA, d3.id, {
    lines: d3.lines.map((l, i) =>
      i === 0 ? { lineId: l.id, receivedQty: 2, missingQty: 1, damagedQty: 1, note: "1 short, 1 torn seam" } : { lineId: l.id, receivedQty: l.quantity, missingQty: 0, damagedQty: 0 },
    ),
  });
  await send(storeB, accessories.slice(2, 8), 3); // in transit
  await saveDraft(manager, null, { toLocationId: storeA, lines: clothing.slice(30, 33).map((p) => ({ productId: p.id, quantity: 2 })) });
  console.log("Seeded 5 dispatches.");

  // Phase 5: a manual restock request waiting for the Store Room.
  await createManualRequest(staffB, { note: "Weekend rush", lines: clothing.slice(12, 16).map((p) => ({ productId: p.id, quantity: 6 })) });
  console.log("Seeded 1 restock request.");

  // Phase 6: a few sales at Store A (leaves some items low) and pending return/damage reports.
  const owner = await ctxFor("owner@demo.test");
  for (let i = 0; i < 6; i++) {
    await applySale(owner, { locationId: storeA, externalRef: `DEMO-BILL-${i + 1}`, items: [{ barcode: clothing[i].barcode, quantity: 3 }, { barcode: clothing[i + 6].barcode, quantity: 1 }] }, "INTERNAL");
  }
  await createEntries(staffA, { type: "DAMAGED", reason: "Stain that will not wash out", lines: [{ productId: clothing[8].id, quantity: 1 }] });
  await createEntries(staffB, { type: "RETURN_TO_STOREROOM", reason: "Slow seller", lines: [{ productId: clothing[14].id, quantity: 2 }] });
  console.log("Seeded 6 sales and 2 return/damage entries.");

  // Phase 8: supplier bills (one paid, one due soon, one overdue).
  const d = (n: number) => isoDay(new Date(Date.now() + n * 864e5));
  const paid = await saveSupplierBill(manager, null, { supplierId: s1.id, billNumber: "LT-2041", billDate: d(-40), dueDate: d(-10), amount: "38450" });
  await markSupplierBillPaid(owner, paid.id, { note: "Paid by NEFT" });
  await saveSupplierBill(manager, null, { supplierId: s2.id, billNumber: "TS-118", billDate: d(-35), dueDate: d(-5), amount: "9620", note: "Ask for 2% discount" });
  await saveSupplierBill(manager, null, { supplierId: s1.id, billNumber: "LT-2077", billDate: d(-3), dueDate: d(12), amount: "15200" });
  console.log("Seeded 3 supplier bills.");
}

/** Platform bills issued by the PLATFORM_ADMIN (one overdue for the demo shop). */
export async function seedPlatformBills(demoTenantId: string, otherTenantId: string) {
  const { adminSavePlatformBill, adminMarkPlatformBillPaid } = await import("@/server/data/bills");
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, "admin@demo.test"));
  const admin = { userId: u.id, role: "PLATFORM_ADMIN" as const, tenantId: null, locationIds: [], tenantStatus: null, name: u.name, email: u.email };
  const d = (n: number) => isoDay(new Date(Date.now() + n * 864e5));
  const sept = await adminSavePlatformBill(admin, demoTenantId, null, { billNumber: "BB-2026-09", description: "Subscription, September 2026", amount: "999", issueDate: d(-33), dueDate: d(-18) });
  await adminMarkPlatformBillPaid(admin, sept.id, { note: "Paid by UPI" });
  await adminSavePlatformBill(admin, demoTenantId, null, { billNumber: "BB-2026-10", description: "Subscription, October 2026", amount: "999", issueDate: d(-3), dueDate: d(-1) });
  await adminSavePlatformBill(admin, otherTenantId, null, { billNumber: "BB-2026-10-O", description: "Subscription, October 2026", amount: "999", issueDate: d(-3), dueDate: d(12) });
  console.log("Seeded 3 platform bills.");
}
