import type { Types } from "mongoose";
import type { TenantCtx } from "@/server/context";
import { saveSupplier, listSuppliers } from "@/server/data/suppliers";
import { importProducts, listProducts } from "@/server/data/products";
import { receiveStock } from "@/server/stock/receipts";
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
}
