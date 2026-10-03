"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { updateCompany, setLowStockEmail } from "@/server/data/tenant";
import { rotateApiKey, revokeApiKey } from "@/server/data/apikeys";

export async function updateCompanyAction(key: string, input: unknown) {
  return toResult(async () => {
    const r = await updateCompany(await getCtx(), input, key);
    revalidatePath("/owner", "layout");
    return r;
  });
}

export async function rotateApiKeyAction(key: string) {
  return toResult(async () => {
    const r = await rotateApiKey(await getCtx(), key);
    revalidatePath("/owner/settings");
    return r;
  });
}

export async function revokeApiKeyAction(key: string) {
  return toResult(async () => {
    const r = await revokeApiKey(await getCtx(), key);
    revalidatePath("/owner/settings");
    return r;
  });
}

export async function setLowStockEmailAction(key: string, enabled: boolean) {
  return toResult(async () => {
    const r = await setLowStockEmail(await getCtx(), { enabled }, key);
    revalidatePath("/owner/settings");
    return r;
  });
}
