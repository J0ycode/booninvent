import "server-only";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Tx } from "../db";
import { products, productCosts, suppliers } from "../db/schema";
import { productSearch, chunk } from "../db/helpers";
import type { Category } from "../db/types";
import { guard, tf, isId, assertId } from "./guard";
import { runMutation, nextSeq, reserveSeq } from "../mutation";
import { AppError, isDuplicateKey, duplicateConstraint } from "../errors";
import { objectId, rupeesToPaise } from "@/lib/validation";
import type { Ctx, TenantCtx } from "../context";

const ALL = ["OWNER", "STOREROOM_MANAGER", "STORE_STAFF"] as const;
const MANAGERS = ["OWNER", "STOREROOM_MANAGER"] as const;

export const canSeeCost = (ctx: Pick<Ctx, "role">) => ctx.role === "OWNER" || ctx.role === "STOREROOM_MANAGER";

export interface ProductView {
  id: string;
  name: string;
  category: Category;
  sku: string;
  barcode: string;
  sellingPrice: number;
  supplierId: string | null;
  reorderLevel: number;
  active: boolean;
  /** Present ONLY for OWNER / STOREROOM_MANAGER. The key is absent for store staff. */
  costPrice?: number | null;
}

type ProductRow = typeof products.$inferSelect;

function view(p: ProductRow): ProductView {
  return {
    id: p.id,
    name: p.name,
    category: p.category,
    sku: p.sku,
    barcode: p.barcode,
    sellingPrice: p.sellingPrice,
    supplierId: p.supplierId,
    reorderLevel: p.reorderLevel,
    active: p.active,
  };
}

/** Adds costPrice for managers only. product_costs is never queried for other roles. */
async function withCosts(ctx: TenantCtx, rows: ProductView[]): Promise<ProductView[]> {
  if (!canSeeCost(ctx) || !rows.length) return rows;
  const db = await getDb();
  const ids = rows.map((r) => r.id);
  const costs = await db
    .select({ productId: productCosts.productId, costPrice: productCosts.costPrice })
    .from(productCosts)
    .where(and(eq(productCosts.tenantId, ctx.tenantId), inArray(productCosts.productId, ids)));
  const map = new Map(costs.map((c) => [c.productId, c.costPrice]));
  return rows.map((r) => ({ ...r, costPrice: map.get(r.id) ?? null }));
}

export interface ProductQuery {
  q?: string;
  category?: Category | "";
  supplierId?: string;
  status?: "active" | "inactive" | "all";
  ids?: string[];
  page?: number;
  pageSize?: number;
}

/** Server-side search + pagination. Matches exact barcode, SKU prefix, or name. */
export async function listProducts(ctx: Ctx | null, query: ProductQuery = {}) {
  const c = await guard(ctx, ALL);
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const ids = query.ids?.filter(isId);
  if (ids && !ids.length) return { rows: [] as ProductView[], total: 0, page, pageSize };
  const status = c.role === "STORE_STAFF" ? "active" : (query.status ?? "active");
  const where = and(
    eq(products.tenantId, c.tenantId),
    status === "all" ? undefined : eq(products.active, status === "active"),
    query.category ? eq(products.category, query.category) : undefined,
    isId(query.supplierId) ? eq(products.supplierId, query.supplierId) : undefined,
    ids ? inArray(products.id, ids) : undefined,
    productSearch(query.q),
  );
  const db = await getDb();
  const rows = await db
    .select()
    .from(products)
    .where(where)
    .orderBy(asc(products.nameLower), asc(products.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(products).where(where);
  return { rows: await withCosts(c, rows.map(view)), total, page, pageSize };
}

export async function getProduct(ctx: Ctx | null, id: string): Promise<ProductView> {
  const c = await guard(ctx, ALL);
  assertId(id, "Product not found.");
  const db = await getDb();
  const [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, c.tenantId), eq(products.id, id)));
  if (!p || (c.role === "STORE_STAFF" && !p.active)) throw new AppError("NOT_FOUND", "Product not found.");
  return (await withCosts(c, [view(p)]))[0];
}

/** Products by id (any status) for documents like receipts and dispatches. */
export async function getProductsByIds(ctx: Ctx | null, ids: string[]): Promise<Map<string, ProductView>> {
  const c = await guard(ctx, ALL);
  const unique = [...new Set(ids)].filter(isId);
  if (!unique.length) return new Map();
  const db = await getDb();
  const rows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, c.tenantId), inArray(products.id, unique)));
  return new Map((await withCosts(c, rows.map(view))).map((p) => [p.id, p]));
}

/** Scan lookup: exact barcode first, then exact SKU. */
export async function findByCode(ctx: Ctx | null, code: string): Promise<ProductView | null> {
  const c = await guard(ctx, ALL);
  const v = code.trim();
  if (!v) return null;
  const db = await getDb();
  let [p] = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, c.tenantId), eq(products.barcode, v)));
  if (!p) {
    [p] = await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, c.tenantId), sql`lower(${products.sku}) = ${v.toLowerCase()}`))
      .limit(1);
  }
  if (!p || (c.role === "STORE_STAFF" && !p.active)) return null;
  return (await withCosts(c, [view(p)]))[0];
}

/* ---------- create / update ---------- */

const optionalPaise = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || String(v).trim() === "") return null;
    const r = rupeesToPaise.safeParse(v);
    if (!r.success) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount" });
      return z.NEVER;
    }
    return r.data;
  });

export const productSchema = z.object({
  name: z.string().trim().min(2, "Enter the product name").max(120),
  category: z.enum(["CLOTHING", "ACCESSORY"], { message: "Pick a category" }),
  sku: z.string().trim().max(40).optional().default(""),
  barcode: z
    .string()
    .trim()
    .max(48)
    .regex(/^[\x20-\x7E]*$/, "Barcode can only use letters, numbers and symbols")
    .optional()
    .default(""),
  sellingPrice: rupeesToPaise,
  costPrice: optionalPaise,
  supplierId: objectId.optional().nullable().or(z.literal("")),
  reorderLevel: z.coerce.number().int("Use whole pieces").min(0, "Cannot be negative").max(100000).default(0),
  active: z.boolean().optional().default(true),
});
export type ProductInput = z.input<typeof productSchema>;

async function autoBarcode(tenantId: string, tx: Tx) {
  for (;;) {
    const code = `BB${String(await nextSeq(tenantId, "barcode", tx)).padStart(8, "0")}`;
    const [hit] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.barcode, code)));
    if (!hit) return code;
  }
}
async function autoSku(tenantId: string, tx: Tx) {
  for (;;) {
    const sku = `SKU-${String(await nextSeq(tenantId, "sku", tx)).padStart(5, "0")}`;
    const [hit] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.sku, sku)));
    if (!hit) return sku;
  }
}

function dupMessage(e: unknown) {
  const name = duplicateConstraint(e);
  if (name === "products_tenant_barcode_uq") return "Another product already uses this barcode.";
  if (name === "products_tenant_sku_uq") return "Another product already uses this SKU.";
  return "This product already exists.";
}

/** A unique violation aborts the whole Postgres transaction, so it is turned into a friendly error outside runMutation. */
async function friendlyDuplicate<T>(run: () => Promise<T>, wrap: (message: string) => string = (m) => m): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (isDuplicateKey(e) && duplicateConstraint(e).startsWith("products_")) throw new AppError("CONFLICT", wrap(dupMessage(e)));
    throw e;
  }
}

async function assertSupplier(ctx: TenantCtx, supplierId: string | null | undefined) {
  if (!supplierId) return null;
  const db = await getDb();
  const [s] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.id, supplierId)));
  if (!s) throw new AppError("VALIDATION", "Pick one of your suppliers.");
  return supplierId;
}

type ParsedProduct = z.output<typeof productSchema>;

async function setCost(ctx: TenantCtx, productId: string, costPrice: number, tx: Tx) {
  await tx
    .insert(productCosts)
    .values({ ...tf(ctx), productId, costPrice })
    .onConflictDoUpdate({ target: [productCosts.tenantId, productCosts.productId], set: { costPrice, updatedAt: new Date() } });
}

/** Inserts one product (+ cost) inside an existing transaction. */
async function insertProduct(ctx: TenantCtx, d: ParsedProduct, tx: Tx) {
  const barcode = d.barcode || (await autoBarcode(ctx.tenantId, tx));
  const sku = d.sku || (await autoSku(ctx.tenantId, tx));
  const [p] = await tx
    .insert(products)
    .values({
      ...tf(ctx),
      name: d.name,
      nameLower: d.name.toLowerCase(),
      category: d.category,
      sku,
      barcode,
      sellingPrice: d.sellingPrice,
      supplierId: d.supplierId || null,
      reorderLevel: d.reorderLevel,
      active: d.active,
    })
    .returning();
  if (d.costPrice !== null && d.costPrice !== undefined) await setCost(ctx, p.id, d.costPrice, tx);
  return p;
}

export async function createProduct(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<ProductView> {
  const c = await guard(ctx, MANAGERS);
  const d = productSchema.parse(input);
  await assertSupplier(c, d.supplierId);
  return friendlyDuplicate(() =>
    runMutation(c, { action: "product.create", entity: "product", idempotencyKey }, async (tx) => {
      const p = await insertProduct(c, d, tx);
      return { result: { ...view(p), costPrice: d.costPrice ?? null }, entityId: p.id, audit: { name: d.name, sku: p.sku, barcode: p.barcode } };
    }),
  );
}

export async function updateProduct(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<ProductView> {
  const c = await guard(ctx, MANAGERS);
  assertId(id, "Product not found.");
  const d = productSchema.parse(input);
  await assertSupplier(c, d.supplierId);
  const mine = and(eq(products.tenantId, c.tenantId), eq(products.id, id));
  return friendlyDuplicate(() =>
    runMutation(c, { action: "product.update", entity: "product", idempotencyKey }, async (tx) => {
      const [existing] = await tx.select().from(products).where(mine).for("update");
      if (!existing) throw new AppError("NOT_FOUND", "Product not found.");
      const [p] = await tx
        .update(products)
        .set({
          name: d.name,
          nameLower: d.name.toLowerCase(),
          category: d.category,
          sku: d.sku || existing.sku,
          barcode: d.barcode || existing.barcode,
          sellingPrice: d.sellingPrice,
          supplierId: d.supplierId || null,
          reorderLevel: d.reorderLevel,
          active: d.active,
        })
        .where(mine)
        .returning();
      if (d.costPrice === null || d.costPrice === undefined) {
        await tx.delete(productCosts).where(and(eq(productCosts.tenantId, c.tenantId), eq(productCosts.productId, id)));
      } else {
        await setCost(c, id, d.costPrice, tx);
      }
      return { result: { ...view(p), costPrice: d.costPrice ?? null }, entityId: id, audit: { before: { sellingPrice: existing.sellingPrice }, after: d } };
    }),
  );
}

/* ---------- CSV import ---------- */

export const IMPORT_MAX_ROWS = 5000;

export interface ImportRowResult {
  row: number; // 1-based data row (header excluded)
  name: string;
  sku: string;
  barcode: string;
  errors: string[];
}

/** CSV columns (case-insensitive): name, category, sku, barcode, sellingPrice, costPrice, supplier, reorderLevel */
const importRow = z.object({
  name: z.string().optional().default(""),
  category: z.string().optional().default(""),
  sku: z.string().optional().default(""),
  barcode: z.string().optional().default(""),
  sellingprice: z.string().optional().default(""),
  costprice: z.string().optional().default(""),
  supplier: z.string().optional().default(""),
  reorderlevel: z.string().optional().default("0"),
});

const CATEGORY_ALIASES: Record<string, Category> = { clothing: "CLOTHING", clothes: "CLOTHING", accessory: "ACCESSORY", accessories: "ACCESSORY" };

function normalizeKeys(r: Record<string, unknown>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) out[k.toLowerCase().replace(/[\s_-]/g, "")] = v == null ? "" : String(v).trim();
  return out;
}

/**
 * Validates every row. With commit=false it only returns the preview.
 * With commit=true it inserts all rows in one transaction, but only if there are no errors (all or nothing).
 */
export async function importProducts(ctx: Ctx | null, rawRows: unknown, commit: boolean, idempotencyKey?: string) {
  const c = await guard(ctx, MANAGERS);
  if (!Array.isArray(rawRows)) throw new AppError("VALIDATION", "The file has no rows.");
  if (rawRows.length === 0) throw new AppError("VALIDATION", "The file has no rows.");
  if (rawRows.length > IMPORT_MAX_ROWS) throw new AppError("VALIDATION", `Import up to ${IMPORT_MAX_ROWS} rows at a time.`);

  const db = await getDb();
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.tenantId, c.tenantId));
  const supplierByName = new Map(supplierRows.map((s) => [s.name.toLowerCase(), s.id]));
  const existing = await db.select({ sku: products.sku, barcode: products.barcode }).from(products).where(eq(products.tenantId, c.tenantId));
  const usedSku = new Set(existing.map((p) => p.sku.toLowerCase()));
  const usedBarcode = new Set(existing.map((p) => p.barcode));

  const results: ImportRowResult[] = [];
  const parsed: ParsedProduct[] = [];
  rawRows.forEach((raw, i) => {
    const r = importRow.parse(normalizeKeys((raw ?? {}) as Record<string, unknown>));
    const errors: string[] = [];
    const category = CATEGORY_ALIASES[r.category.toLowerCase()] ?? (r.category.toUpperCase() as Category);
    const supplierId = r.supplier ? supplierByName.get(r.supplier.toLowerCase()) : undefined;
    if (r.supplier && !supplierId) errors.push(`Supplier "${r.supplier}" not found. Add it first.`);
    const res = productSchema.safeParse({
      name: r.name,
      category,
      sku: r.sku,
      barcode: r.barcode,
      sellingPrice: r.sellingprice,
      costPrice: r.costprice,
      supplierId: supplierId ?? "",
      reorderLevel: r.reorderlevel || "0",
    });
    if (!res.success) for (const iss of res.error.issues) errors.push(`${iss.path.join(".") || "row"}: ${iss.message}`);
    if (r.sku) {
      if (usedSku.has(r.sku.toLowerCase())) errors.push("SKU already used");
      usedSku.add(r.sku.toLowerCase());
    }
    if (r.barcode) {
      if (usedBarcode.has(r.barcode)) errors.push("Barcode already used");
      usedBarcode.add(r.barcode);
    }
    results.push({ row: i + 1, name: r.name, sku: r.sku, barcode: r.barcode, errors });
    if (res.success && !errors.length) parsed.push(res.data);
  });

  const errorCount = results.filter((r) => r.errors.length).length;
  if (!commit || errorCount) return { results, valid: parsed.length, errorCount, imported: 0 };

  const imported = await friendlyDuplicate(
    () =>
      runMutation(c, { action: "product.import", entity: "product", idempotencyKey }, async (tx) => {
        // Reserve counter ranges once, then insert in bulk (fast even for 5,000 rows).
        let b = await reserveSeq(c.tenantId, "barcode", parsed.filter((d) => !d.barcode).length, tx);
        let k = await reserveSeq(c.tenantId, "sku", parsed.filter((d) => !d.sku).length, tx);
        const rows = parsed.map((d) => {
          let barcode = d.barcode;
          while (!barcode || (barcode !== d.barcode && usedBarcode.has(barcode))) barcode = `BB${String(++b).padStart(8, "0")}`;
          usedBarcode.add(barcode);
          let sku = d.sku;
          while (!sku || (sku !== d.sku && usedSku.has(sku.toLowerCase()))) sku = `SKU-${String(++k).padStart(5, "0")}`;
          usedSku.add(sku.toLowerCase());
          return {
            id: randomUUID(),
            ...tf(c),
            name: d.name,
            nameLower: d.name.toLowerCase(),
            category: d.category,
            sku,
            barcode,
            sellingPrice: d.sellingPrice,
            supplierId: d.supplierId || null,
            reorderLevel: d.reorderLevel,
            active: d.active,
            cost: d.costPrice,
          };
        });
        for (const part of chunk(rows)) await tx.insert(products).values(part.map(({ cost: _cost, ...p }) => p));
        const costs = rows.filter((r) => r.cost !== null && r.cost !== undefined).map((r) => ({ ...tf(c), productId: r.id, costPrice: r.cost! }));
        for (const part of chunk(costs)) await tx.insert(productCosts).values(part);
        return { result: rows.length, audit: { count: rows.length } };
      }),
    (m) => `Import stopped: ${m} Nothing was imported.`,
  );
  return { results, valid: parsed.length, errorCount: 0, imported };
}
