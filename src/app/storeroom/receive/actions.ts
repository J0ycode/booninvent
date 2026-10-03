"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { receiveStock } from "@/server/stock/receipts";

export async function receiveStockAction(key: string, input: unknown) {
  return toResult(async () => {
    const r = await receiveStock(await getCtx(), input, key);
    revalidatePath("/storeroom", "layout");
    return r;
  });
}
