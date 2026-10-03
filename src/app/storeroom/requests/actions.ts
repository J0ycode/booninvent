"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { approveRequest, rejectRequest } from "@/server/data/restock";

const refresh = () => {
  revalidatePath("/store", "layout");
  revalidatePath("/storeroom", "layout");
};

export async function approveRequestAction(key: string, id: string) {
  return toResult(async () => {
    const r = await approveRequest(await getCtx(), id, key);
    refresh();
    return r;
  });
}
export async function rejectRequestAction(key: string, id: string, input: unknown) {
  return toResult(async () => {
    const r = await rejectRequest(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
