"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { receiveDispatch } from "@/server/stock/dispatches";

export async function receiveDispatchAction(key: string, id: string, input: unknown) {
  return toResult(async () => {
    const r = await receiveDispatch(await getCtx(), id, input, key);
    revalidatePath("/store", "layout");
    revalidatePath("/storeroom", "layout");
    return r;
  });
}
