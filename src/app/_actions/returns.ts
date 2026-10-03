"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { createEntries, approveEntry, rejectEntry } from "@/server/stock/returns";

const refresh = () => {
  for (const p of ["/store", "/storeroom", "/owner"]) revalidatePath(p, "layout");
};

export async function createEntriesAction(key: string, input: unknown) {
  return toResult(async () => {
    const r = await createEntries(await getCtx(), input, key);
    refresh();
    return r;
  });
}
export async function approveEntryAction(key: string, id: string) {
  return toResult(async () => {
    const r = await approveEntry(await getCtx(), id, key);
    refresh();
    return r;
  });
}
export async function rejectEntryAction(key: string, id: string, input: unknown) {
  return toResult(async () => {
    const r = await rejectEntry(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
