import "server-only";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { suppliers } from "../db/schema";
import { guard, tf, assertId } from "./guard";
import { runMutation } from "../mutation";
import { AppError, isDuplicateKey } from "../errors";
import { optionalText } from "@/lib/validation";
import type { Ctx } from "../context";

const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

export interface SupplierView {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  gstin?: string;
  address?: string;
  active: boolean;
}
const view = (s: typeof suppliers.$inferSelect): SupplierView => ({
  id: s.id,
  name: s.name,
  phone: s.phone ?? undefined,
  email: s.email ?? undefined,
  gstin: s.gstin ?? undefined,
  address: s.address ?? undefined,
  active: s.active,
});

/** Suppliers are a Store Room / Owner concern; store staff do not need them. */
export async function listSuppliers(ctx: Ctx | null, opts: { activeOnly?: boolean } = {}): Promise<SupplierView[]> {
  const c = await guard(ctx, MANAGERS);
  const db = await getDb();
  const rows = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, c.tenantId), opts.activeOnly ? eq(suppliers.active, true) : undefined))
    .orderBy(asc(suppliers.name));
  return rows.map(view);
}

export const supplierSchema = z.object({
  name: z.string().trim().min(2, "Enter the supplier name").max(100),
  phone: optionalText(30),
  email: optionalText(120),
  gstin: optionalText(20),
  address: optionalText(300),
  active: z.boolean().optional().default(true),
});

export async function saveSupplier(ctx: Ctx | null, id: string | null, input: unknown, idempotencyKey?: string): Promise<SupplierView> {
  const c = await guard(ctx, MANAGERS);
  if (id) assertId(id, "Supplier not found.");
  const d = supplierSchema.parse(input);
  // Empty optional fields are stored as NULL (so clearing a field on edit really clears it).
  const values = { name: d.name, phone: d.phone ?? null, email: d.email ?? null, gstin: d.gstin ?? null, address: d.address ?? null, active: d.active };
  try {
    return await runMutation(c, { action: id ? "supplier.update" : "supplier.create", entity: "supplier", idempotencyKey }, async (tx) => {
      if (id) {
        const [s] = await tx
          .update(suppliers)
          .set(values)
          .where(and(eq(suppliers.tenantId, c.tenantId), eq(suppliers.id, id)))
          .returning();
        if (!s) throw new AppError("NOT_FOUND", "Supplier not found.");
        return { result: view(s), entityId: id, audit: d };
      }
      const [s] = await tx
        .insert(suppliers)
        .values({ ...tf(c), ...values })
        .returning();
      return { result: view(s), entityId: s.id, audit: d };
    });
  } catch (e) {
    if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A supplier with this name already exists.");
    throw e;
  }
}
