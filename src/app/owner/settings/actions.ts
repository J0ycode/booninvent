"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { updateCompany } from "@/server/data/tenant";

export async function updateCompanyAction(key: string, input: unknown) {
  return toResult(async () => {
    const r = await updateCompany(await getCtx(), input, key);
    revalidatePath("/owner", "layout");
    return r;
  });
}
