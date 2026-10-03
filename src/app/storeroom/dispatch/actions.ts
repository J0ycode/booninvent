"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { saveDraft, sendDispatch, discardDraft, resolveDiscrepancy } from "@/server/stock/dispatches";

const refresh = () => {
  revalidatePath("/storeroom", "layout");
  revalidatePath("/store", "layout");
};

export async function saveDraftAction(key: string, id: string | null, input: unknown) {
  return toResult(async () => {
    const r = await saveDraft(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
export async function sendDispatchAction(key: string, id: string) {
  return toResult(async () => {
    const r = await sendDispatch(await getCtx(), id, key);
    refresh();
    return r;
  });
}
export async function discardDraftAction(key: string, id: string) {
  return toResult(async () => {
    const r = await discardDraft(await getCtx(), id, key);
    refresh();
    return r;
  });
}
export async function resolveDiscrepancyAction(key: string, id: string, input: unknown) {
  return toResult(async () => {
    const r = await resolveDiscrepancy(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
