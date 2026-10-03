import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { getCtx } from "@/server/context";
import { listLocations } from "@/server/data/locations";
import { DispatchForm } from "../dispatch-form";

export const metadata: Metadata = { title: "New dispatch" };

export default async function NewDispatchPage() {
  const locations = await listLocations(await getCtx());
  const storeRoom = locations.find((l) => l.type === "STORE_ROOM")!;
  const stores = locations.filter((l) => l.type === "STORE").map((s) => ({ id: s.id, name: s.name }));
  return (
    <>
      <PageHeader title="New dispatch" description="Saved as a draft. No stock moves until you press Send." back={{ href: "/storeroom/dispatch", label: "Dispatch" }} />
      <DispatchForm stores={stores} storeRoomId={storeRoom.id} />
    </>
  );
}
