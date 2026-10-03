import "server-only";
import { z } from "zod";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import { locations } from "../db/schema";
import type { LocationType } from "../db/types";
import { guard, tf, assertId } from "./guard";
import { runMutation } from "../mutation";
import { AppError, isDuplicateKey } from "../errors";
import type { Ctx } from "../context";

export interface LocationView {
  id: string;
  name: string;
  type: LocationType;
  active: boolean;
}
const view = (l: typeof locations.$inferSelect): LocationView => ({ id: l.id, name: l.name, type: l.type, active: l.active });

/** STORE_STAFF only see their own store; everyone else sees all locations of the shop. */
export async function listLocations(ctx: Ctx | null): Promise<LocationView[]> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"]);
  if (c.role === "STORE_STAFF" && !c.locationIds.length) return [];
  const db = await getDb();
  const rows = await db
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, c.tenantId), c.role === "STORE_STAFF" ? inArray(locations.id, c.locationIds) : undefined))
    .orderBy(desc(locations.type), asc(locations.name)); // STORE_ROOM first
  return rows.map(view);
}

export async function getStoreRoom(ctx: Ctx | null): Promise<LocationView> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"]);
  const db = await getDb();
  const [l] = await db
    .select()
    .from(locations)
    .where(and(eq(locations.tenantId, c.tenantId), eq(locations.type, "STORE_ROOM")));
  if (!l) throw new AppError("NOT_FOUND", "Store Room not found.");
  return view(l);
}

const nameSchema = z.object({ name: z.string().trim().min(2, "Enter a name").max(60) });

export async function addStore(ctx: Ctx | null, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  const { name } = nameSchema.parse(input);
  try {
    return await runMutation(c, { action: "location.create", entity: "location", idempotencyKey }, async (tx) => {
      const [l] = await tx
        .insert(locations)
        .values({ ...tf(c), name, type: "STORE" })
        .returning();
      return { result: view(l), entityId: l.id, audit: { name } };
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A location with this name already exists.");
    throw e;
  }
}

export async function renameLocation(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  assertId(id, "Location not found.");
  const { name } = nameSchema.parse(input);
  try {
    return await runMutation(c, { action: "location.rename", entity: "location", idempotencyKey }, async (tx) => {
      const [l] = await tx
        .update(locations)
        .set({ name })
        .where(and(eq(locations.tenantId, c.tenantId), eq(locations.id, id)))
        .returning();
      if (!l) throw new AppError("NOT_FOUND", "Location not found.");
      return { result: view(l), entityId: id, audit: { name } };
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A location with this name already exists.");
    throw e;
  }
}
