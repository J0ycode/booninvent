import type { Types } from "mongoose";

export interface SeedTenant {
  tenant: { _id: Types.ObjectId };
  storeRoom: { _id: Types.ObjectId };
  stores: { _id: Types.ObjectId }[];
}

/** Catalog, stock and documents for the demo shop. Extended as phases are added. */
export async function seedCatalogAndStock(_t: SeedTenant) {
  // Phase 2+ adds suppliers, products and stock here.
}
