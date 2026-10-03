import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/server/context";
import { listUsers } from "@/server/data/users";
import { listLocations } from "@/server/data/locations";
import { UsersClient } from "./users-client";

export const metadata: Metadata = { title: "Users and Locations" };

export default async function UsersPage() {
  const ctx = await getCtx();
  const [users, locations] = await Promise.all([listUsers(ctx), listLocations(ctx)]);
  return (
    <>
      <PageHeader title="Users and Locations" description="Invite people and manage your stores." />
      <UsersClient users={users} locations={locations} meId={ctx!.userId} />
    </>
  );
}
