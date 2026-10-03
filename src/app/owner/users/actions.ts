"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { toResult } from "@/server/action";
import { inviteUser, updateUser, resendInvite } from "@/server/data/users";
import { addStore, renameLocation } from "@/server/data/locations";

const done = <T,>(r: T) => {
  revalidatePath("/owner/users");
  return r;
};

export async function inviteUserAction(key: string, input: unknown) {
  return toResult(async () => done(await inviteUser(await getCtx(), input, key)));
}
export async function updateUserAction(key: string, id: string, input: unknown) {
  return toResult(async () => done(await updateUser(await getCtx(), id, input, key)));
}
export async function resendInviteAction(_key: string, id: string) {
  return toResult(async () => resendInvite(await getCtx(), id));
}
export async function addStoreAction(key: string, input: unknown) {
  return toResult(async () => done(await addStore(await getCtx(), input, key)));
}
export async function renameLocationAction(key: string, id: string, input: unknown) {
  return toResult(async () => done(await renameLocation(await getCtx(), id, input, key)));
}
