"use server";

import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { findByCode, type ProductView } from "@/server/data/products";
import { listLocations } from "@/server/data/locations";
import { getLevels } from "@/server/stock/read";

export interface LookupResult {
  product: ProductView;
  levels: { locationId: string; name: string; quantity: number }[];
}

/** Scan / type a barcode or SKU. Returns the product and stock at the locations this user may see. */
export async function lookupCodeAction(_key: string, code: string) {
  return toResult(async (): Promise<LookupResult | null> => {
    const ctx = await getCtx();
    const product = await findByCode(ctx, code);
    if (!product) return null;
    const [locations, levels] = await Promise.all([listLocations(ctx), getLevels(ctx, [product.id])]);
    return {
      product,
      levels: locations.map((l) => ({ locationId: l.id, name: l.name, quantity: levels[product.id]?.[l.id] ?? 0 })),
    };
  });
}
