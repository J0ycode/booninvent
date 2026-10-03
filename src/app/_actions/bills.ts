"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import {
  saveSupplierBill,
  deleteSupplierBill,
  markSupplierBillPaid,
  markSupplierBillUnpaid,
  adminSavePlatformBill,
  adminDeletePlatformBill,
  adminMarkPlatformBillPaid,
  adminMarkPlatformBillUnpaid,
  adminSetShopStatus,
} from "@/server/data/bills";

const refresh = () => {
  for (const p of ["/owner", "/storeroom", "/admin"]) revalidatePath(p, "layout");
};
const wrap = <T,>(fn: () => Promise<T>) =>
  toResult(async () => {
    const r = await fn();
    refresh();
    return r;
  });

/* supplier bills (OWNER / STOREROOM_MANAGER) */
export async function saveSupplierBillAction(key: string, id: string | null, input: unknown) {
  return wrap(async () => saveSupplierBill(await getCtx(), id, input, key));
}
export async function deleteSupplierBillAction(key: string, id: string) {
  return wrap(async () => deleteSupplierBill(await getCtx(), id, key));
}
export async function markSupplierPaidAction(key: string, id: string, input: unknown) {
  return wrap(async () => markSupplierBillPaid(await getCtx(), id, input, key));
}
export async function markSupplierUnpaidAction(key: string, id: string) {
  return wrap(async () => markSupplierBillUnpaid(await getCtx(), id, key));
}

/* platform bills + shops (PLATFORM_ADMIN) */
export async function savePlatformBillAction(key: string, tenantId: string, id: string | null, input: unknown) {
  return wrap(async () => adminSavePlatformBill(await getCtx(), tenantId, id, input, key));
}
export async function deletePlatformBillAction(key: string, id: string) {
  return wrap(async () => adminDeletePlatformBill(await getCtx(), id, key));
}
export async function markPlatformPaidAction(key: string, id: string, input: unknown) {
  return wrap(async () => adminMarkPlatformBillPaid(await getCtx(), id, input, key));
}
export async function markPlatformUnpaidAction(key: string, id: string) {
  return wrap(async () => adminMarkPlatformBillUnpaid(await getCtx(), id, key));
}
export async function setShopStatusAction(key: string, tenantId: string, status: string) {
  return wrap(async () => adminSetShopStatus(await getCtx(), tenantId, status, key));
}
