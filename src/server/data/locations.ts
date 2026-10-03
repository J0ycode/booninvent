import "server-only";
import { z } from "zod";
import { Location, type LocationDoc } from "../models/core";
import { guard, tf } from "./guard";
import { runMutation } from "../mutation";
import { AppError, isDuplicateKey } from "../errors";
import type { Ctx } from "../context";

export interface LocationView {
  id: string;
  name: string;
  type: LocationDoc["type"];
  active: boolean;
}
const view = (l: LocationDoc): LocationView => ({ id: String(l._id), name: l.name, type: l.type, active: l.active });

/** STORE_STAFF only see their own store; everyone else sees all locations of the shop. */
export async function listLocations(ctx: Ctx | null): Promise<LocationView[]> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"]);
  const filter = c.role === "STORE_STAFF" ? { ...tf(c), _id: { $in: c.locationIds } } : tf(c);
  const rows = await Location.find(filter).sort({ type: -1, name: 1 }).lean();
  return rows.map(view);
}

export async function getStoreRoom(ctx: Ctx | null): Promise<LocationView> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"]);
  const l = await Location.findOne({ ...tf(c), type: "STORE_ROOM" }).lean();
  if (!l) throw new AppError("NOT_FOUND", "Store Room not found.");
  return view(l);
}

const nameSchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(60) });

export async function addStore(ctx: Ctx | null, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  const { name } = nameSchema.parse(input);
  return runMutation(c, { action: "location.create", entity: "location", idempotencyKey }, async (session) => {
    try {
      const [l] = await Location.create([{ ...tf(c), name, type: "STORE" }], { session });
      return { result: view(l), entityId: String(l._id), audit: { name } };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A location with this name already exists.");
      throw e;
    }
  });
}

export async function renameLocation(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  const { name } = nameSchema.parse(input);
  return runMutation(c, { action: "location.rename", entity: "location", idempotencyKey }, async (session) => {
    try {
      const l = await Location.findOneAndUpdate({ ...tf(c), _id: id }, { $set: { name } }, { session, returnDocument: "after" }).lean();
      if (!l) throw new AppError("NOT_FOUND", "Location not found.");
      return { result: view(l), entityId: id, audit: { name } };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A location with this name already exists.");
      throw e;
    }
  });
}
