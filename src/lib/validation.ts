import { z } from "zod";

/** Shared Zod pieces used by both client forms and the server. */
export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address");
export const passwordSchema = z.string().min(8, "Use at least 8 characters").max(128);
export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
export const qty = z.coerce.number().int("Use whole pieces").min(1, "Enter at least 1");
export const qtyZeroOk = z.coerce.number().int("Use whole pieces").min(0, "Cannot be negative");

/** Rupees entered in a form ("123.50") -> integer paise. */
export const rupeesToPaise = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? v : Number(String(v).replace(/[,\s₹]/g, ""))))
  .refine((n) => Number.isFinite(n) && n >= 0, "Enter a valid amount")
  .transform((n) => Math.round(n * 100));

export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));
