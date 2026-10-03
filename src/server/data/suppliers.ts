import "server-only";
import { z } from "zod";
import { Supplier, type SupplierDoc } from "../models/business";
import { guard, tf } from "./guard";
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
const view = (s: SupplierDoc): SupplierView => ({
  id: String(s._id),
  name: s.name,
  phone: s.phone,
  email: s.email,
  gstin: s.gstin,
  address: s.address,
  active: s.active,
});

/** Suppliers are a Store Room / Owner concern; store staff do not need them. */
export async function listSuppliers(ctx: Ctx | null, opts: { activeOnly?: boolean } = {}): Promise<SupplierView[]> {
  const c = await guard(ctx, MANAGERS);
  const rows = await Supplier.find({ ...tf(c), ...(opts.activeOnly ? { active: true } : {}) })
    .sort({ name: 1 })
    .lean();
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
  const d = supplierSchema.parse(input);
  return runMutation(c, { action: id ? "supplier.update" : "supplier.create", entity: "supplier", idempotencyKey }, async (session) => {
    try {
      if (id) {
        const s = await Supplier.findOneAndUpdate({ ...tf(c), _id: id }, { $set: d }, { session, returnDocument: "after" }).lean();
        if (!s) throw new AppError("NOT_FOUND", "Supplier not found.");
        return { result: view(s), entityId: id, audit: d };
      }
      const [s] = await Supplier.create([{ ...tf(c), ...d }], { session });
      return { result: view(s.toObject()), entityId: String(s._id), audit: d };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", "A supplier with this name already exists.");
      throw e;
    }
  });
}
