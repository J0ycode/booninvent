"use server";

import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { listProducts } from "@/server/data/products";
import { getLevels } from "@/server/stock/read";

export interface PickerProduct {
  id: string;
  name: string;
  sku: string;
  barcode: string;
  sellingPrice: number;
  /** Stock at `atLocation` when requested. */
  available?: number;
}

/** Typeahead for line editors: top 10 matches (active products), optionally with stock at one location. */
export async function searchProductsAction(_key: string, q: string, atLocation?: string) {
  return toResult(async (): Promise<PickerProduct[]> => {
    const ctx = await getCtx();
    if (!q.trim()) return [];
    const { rows } = await listProducts(ctx, { q, pageSize: 10, status: "active" });
    const levels = atLocation ? await getLevels(ctx, rows.map((r) => r.id), [atLocation]) : {};
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      sku: r.sku,
      barcode: r.barcode,
      sellingPrice: r.sellingPrice,
      available: atLocation ? (levels[r.id]?.[atLocation] ?? 0) : undefined,
    }));
  });
}
