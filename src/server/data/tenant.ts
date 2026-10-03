import "server-only";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tenants } from "../db/schema";
import { guard } from "./guard";
import { runMutation } from "../mutation";
import { AppError } from "../errors";
import { optionalText } from "@/lib/validation";
import type { Ctx } from "../context";

export interface TenantView {
  id: string;
  name: string;
  slug: string;
  status: "ACTIVE" | "SUSPENDED";
  company: { address?: string; phone?: string; email?: string; gstin?: string };
  /** Daily low-stock summary email to the owners. */
  lowStockEmail: boolean;
}

export async function getMyTenant(ctx: Ctx | null): Promise<TenantView> {
  const c = await guard(ctx, ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"]);
  const db = await getDb();
  const [t] = await db.select().from(tenants).where(eq(tenants.id, c.tenantId));
  if (!t) throw new AppError("NOT_FOUND", "Shop not found.");
  return { id: t.id, name: t.name, slug: t.slug, status: t.status, company: t.company ?? {}, lowStockEmail: t.lowStockEmail };
}

export const companySchema = z.object({
  name: z.string().trim().min(2, "Enter the shop name").max(80),
  address: optionalText(300),
  phone: optionalText(30),
  email: optionalText(120),
  gstin: optionalText(20),
});

export async function updateCompany(ctx: Ctx | null, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  const d = companySchema.parse(input);
  return runMutation(c, { action: "tenant.update_company", entity: "tenant", idempotencyKey }, async (tx) => {
    await tx
      .update(tenants)
      .set({ name: d.name, company: { address: d.address, phone: d.phone, email: d.email, gstin: d.gstin } })
      .where(eq(tenants.id, c.tenantId));
    return { result: null, entityId: c.tenantId, audit: d };
  });
}

/** Switches the daily low-stock summary email on or off for this shop. */
export async function setLowStockEmail(ctx: Ctx | null, input: unknown, idempotencyKey?: string) {
  const c = await guard(ctx, ["OWNER"]);
  const { enabled } = z.object({ enabled: z.boolean() }).parse(input);
  return runMutation(c, { action: "tenant.low_stock_email", entity: "tenant", idempotencyKey }, async (tx) => {
    await tx.update(tenants).set({ lowStockEmail: enabled }).where(eq(tenants.id, c.tenantId));
    return { result: { enabled }, entityId: c.tenantId, audit: { enabled } };
  });
}
