import { eq, ilike, like, or, type SQL } from "drizzle-orm";
import { products } from "./schema";

/** Escapes the LIKE wildcards in user text, so "50%" searches for the literal characters. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/** Product search used by every product list: exact barcode, SKU prefix, or name contains (case-insensitive). */
export function productSearch(q: string | undefined | null): SQL | undefined {
  const v = q?.trim();
  if (!v) return undefined;
  return or(eq(products.barcode, v), ilike(products.sku, `${escapeLike(v)}%`), like(products.nameLower, `%${escapeLike(v.toLowerCase())}%`));
}

/** Rows per INSERT statement for bulk inserts (keeps well under Postgres's 65,535 parameter limit). */
export const INSERT_CHUNK = 500;

export function chunk<T>(rows: T[], size = INSERT_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
