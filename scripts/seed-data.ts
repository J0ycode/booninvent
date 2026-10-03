import type { Types } from "mongoose";
import type { TenantCtx } from "@/server/context";
import { saveSupplier, listSuppliers } from "@/server/data/suppliers";
import { importProducts, listProducts } from "@/server/data/products";
import { receiveStock } from "@/server/stock/receipts";
import { saveDraft, sendDispatch, receiveDispatch } from "@/server/stock/dispatches";
import { User } from "@/server/models/core";

export interface SeedTenant {
  tenant: { _id: Types.ObjectId };
  storeRoom: { _id: Types.ObjectId };
  stores: { _id: Types.ObjectId }[];
}

export async function ctxFor(email: string): Promise<TenantCtx> {
  const u = await User.findOne({ email }).lean();
  if (!u || !u.tenantId) throw new Error(`Seed user ${email} missing`);
  return {
    userId: String(u._id),
    role: u.role,
    tenantId: String(u.tenantId),
    locationIds: u.locationIds.map(String),
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
  const storeA = String(_t.stores[0]._id);
  const storeB = String(_t.stores[1]._id);
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
}
