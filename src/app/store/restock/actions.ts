"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { createManualRequest, suggestRestock, decideSuggestedLine, forwardRequest, discardSuggestion } from "@/server/data/restock";

const refresh = () => {
  revalidatePath("/store", "layout");
  revalidatePath("/storeroom", "layout");
};
const wrap = <T,>(fn: () => Promise<T>) =>
  toResult(async () => {
    const r = await fn();
    refresh();
    return r;
  });

export async function createManualRequestAction(key: string, input: unknown) {
  return wrap(async () => createManualRequest(await getCtx(), input, key));
}
export async function suggestRestockAction(key: string) {
  return wrap(async () => suggestRestock(await getCtx(), key));
}
export async function decideLineAction(key: string, id: string, input: unknown) {
  return wrap(async () => decideSuggestedLine(await getCtx(), id, input, key));
}
export async function forwardRequestAction(key: string, id: string) {
  return wrap(async () => forwardRequest(await getCtx(), id, key));
}
export async function discardSuggestionAction(key: string, id: string) {
  return wrap(async () => discardSuggestion(await getCtx(), id, key));
}
