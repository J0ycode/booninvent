"use server";

import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { getReceipt } from "@/server/stock/receipts";
import { getProductsByIds } from "@/server/data/products";
import type { Line } from "@/components/app/lines-editor";

/** "All items from a receipt": one label per received piece. */
export async function receiptLinesAction(_key: string, receiptId: string) {
  return toResult(async (): Promise<Line[]> => {
    const ctx = await getCtx();
    const r = await getReceipt(ctx, receiptId);
    const products = await getProductsByIds(
      ctx,
      r.lines.map((l) => l.productId),
    );
    return r.lines
      .filter((l) => products.has(l.productId))
      .map((l) => {
        const p = products.get(l.productId)!;
        return { productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, quantity: l.quantity, price: p.sellingPrice } as Line;
      });
  });
}
