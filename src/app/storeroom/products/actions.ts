"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { createProduct, updateProduct, importProducts } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";

const refresh = () => revalidatePath("/storeroom/products", "layout");

export async function createProductAction(key: string, input: unknown) {
  return toResult(async () => {
    const r = await createProduct(await getCtx(), input, key);
    refresh();
    return r;
  });
}
export async function updateProductAction(key: string, id: string, input: unknown) {
  return toResult(async () => {
    const r = await updateProduct(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
export async function importProductsAction(key: string, rows: unknown, commit: boolean) {
  return toResult(async () => {
    const r = await importProducts(await getCtx(), rows, commit, key);
    if (commit) refresh();
    return r;
  });
}
export async function saveSupplierAction(key: string, id: string | null, input: unknown) {
  return toResult(async () => {
    const r = await saveSupplier(await getCtx(), id, input, key);
    refresh();
    return r;
  });
}
