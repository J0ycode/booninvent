import "server-only";
import { z } from "zod";
import { Types, type ClientSession } from "mongoose";
import { Product, ProductCost, Supplier, type ProductDoc, type Category } from "../models/business";
import { guard, tf } from "./guard";
import { runMutation, nextSeq } from "../mutation";
import { Counter } from "../models/core";
import { AppError, isDuplicateKey } from "../errors";
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

function view(p: ProductDoc): ProductView {
  return {
    id: String(p._id),
    name: p.name,
    category: p.category,
    sku: p.sku,
    barcode: p.barcode,
    sellingPrice: p.sellingPrice,
    supplierId: p.supplierId ? String(p.supplierId) : null,
    reorderLevel: p.reorderLevel,
    active: p.active,
  };
}

/** Adds costPrice for managers only. productCosts is never queried for other roles. */
async function withCosts(ctx: TenantCtx, rows: ProductView[]): Promise<ProductView[]> {
  if (!canSeeCost(ctx) || !rows.length) return rows;
  const costs = await ProductCost.find({ ...tf(ctx), productId: { $in: rows.map((r) => r.id) } }).lean();
  const map = new Map(costs.map((c) => [String(c.productId), c.costPrice]));
  return rows.map((r) => ({ ...r, costPrice: map.get(r.id) ?? null }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
  const filter: Record<string, unknown> = { ...tf(c) };
  const status = c.role === "STORE_STAFF" ? "active" : (query.status ?? "active");
  if (status !== "all") filter.active = status === "active";
  if (query.category) filter.category = query.category;
  if (query.supplierId && objectId.safeParse(query.supplierId).success) filter.supplierId = query.supplierId;
  if (query.ids) filter._id = { $in: query.ids };
  const q = query.q?.trim();
  if (q) {
    const re = escapeRe(q.toLowerCase());
    filter.$or = [{ barcode: q }, { sku: { $regex: `^${escapeRe(q)}`, $options: "i" } }, { nameLower: { $regex: re } }];
  }
  const pageSize = Math.min(Math.max(query.pageSize ?? 25, 1), 100);
  const page = Math.max(query.page ?? 1, 1);
  const [docs, total] = await Promise.all([
    Product.find(filter)
      .sort({ nameLower: 1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    Product.countDocuments(filter),
  ]);
  return { rows: await withCosts(c, docs.map(view)), total, page, pageSize };
}

export async function getProduct(ctx: Ctx | null, id: string): Promise<ProductView> {
  const c = await guard(ctx, ALL);
  if (!objectId.safeParse(id).success) throw new AppError("NOT_FOUND", "Product not found.");
  const p = await Product.findOne({ ...tf(c), _id: id }).lean();
  if (!p || (c.role === "STORE_STAFF" && !p.active)) throw new AppError("NOT_FOUND", "Product not found.");
  return (await withCosts(c, [view(p)]))[0];
}

/** Products by id (any status) for documents like receipts and dispatches. */
export async function getProductsByIds(ctx: Ctx | null, ids: string[]): Promise<Map<string, ProductView>> {
  const c = await guard(ctx, ALL);
  const docs = await Product.find({ ...tf(c), _id: { $in: [...new Set(ids)] } }).lean();
  return new Map((await withCosts(c, docs.map(view))).map((p) => [p.id, p]));
}

/** Scan lookup: exact barcode first, then exact SKU. */
export async function findByCode(ctx: Ctx | null, code: string): Promise<ProductView | null> {
  const c = await guard(ctx, ALL);
  const v = code.trim();
  if (!v) return null;
  const p =
    (await Product.findOne({ ...tf(c), barcode: v }).lean()) ??
    (await Product.findOne({ ...tf(c), sku: { $regex: `^${escapeRe(v)}$`, $options: "i" } }).lean());
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

async function autoBarcode(tenantId: string, session: ClientSession) {
  for (;;) {
    const code = `BB${String(await nextSeq(tenantId, "barcode", session)).padStart(8, "0")}`;
    if (!(await Product.exists({ tenantId, barcode: code }).session(session))) return code;
  }
}
async function autoSku(tenantId: string, session: ClientSession) {
  for (;;) {
    const sku = `SKU-${String(await nextSeq(tenantId, "sku", session)).padStart(5, "0")}`;
    if (!(await Product.exists({ tenantId, sku }).session(session))) return sku;
  }
}

function dupMessage(e: unknown) {
  const kp = (e as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
  if ("barcode" in kp) return "Another product already uses this barcode.";
  if ("sku" in kp) return "Another product already uses this SKU.";
  return "This product already exists.";
}

async function assertSupplier(ctx: TenantCtx, supplierId: string | null | undefined, session?: ClientSession) {
  if (!supplierId) return null;
  const s = await Supplier.exists({ ...tf(ctx), _id: supplierId }).session(session ?? null);
  if (!s) throw new AppError("VALIDATION", "Pick one of your suppliers.");
  return supplierId;
}

type ParsedProduct = z.output<typeof productSchema>;

/** Inserts one product (+ cost) inside an existing transaction. */
async function insertProduct(ctx: TenantCtx, d: ParsedProduct, session: ClientSession) {
  const barcode = d.barcode || (await autoBarcode(ctx.tenantId, session));
  const sku = d.sku || (await autoSku(ctx.tenantId, session));
  const [p] = await Product.create(
    [
      {
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
      },
    ],
    { session },
  );
  if (d.costPrice !== null && d.costPrice !== undefined) {
    await ProductCost.create([{ ...tf(ctx), productId: p._id, costPrice: d.costPrice }], { session });
  }
  return p.toObject() as ProductDoc;
}

export async function createProduct(ctx: Ctx | null, input: unknown, idempotencyKey?: string): Promise<ProductView> {
  const c = await guard(ctx, MANAGERS);
  const d = productSchema.parse(input);
  await assertSupplier(c, d.supplierId);
  return runMutation(c, { action: "product.create", entity: "product", idempotencyKey }, async (session) => {
    try {
      const p = await insertProduct(c, d, session);
      return { result: { ...view(p), costPrice: d.costPrice ?? null }, entityId: String(p._id), audit: { name: d.name, sku: p.sku, barcode: p.barcode } };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", dupMessage(e));
      throw e;
    }
  });
}

export async function updateProduct(ctx: Ctx | null, id: string, input: unknown, idempotencyKey?: string): Promise<ProductView> {
  const c = await guard(ctx, MANAGERS);
  const d = productSchema.parse(input);
  await assertSupplier(c, d.supplierId);
  return runMutation(c, { action: "product.update", entity: "product", idempotencyKey }, async (session) => {
    const existing = await Product.findOne({ ...tf(c), _id: id }).session(session).lean();
    if (!existing) throw new AppError("NOT_FOUND", "Product not found.");
    try {
      const p = await Product.findOneAndUpdate(
        { ...tf(c), _id: id },
        {
          $set: {
            name: d.name,
            nameLower: d.name.toLowerCase(),
            category: d.category,
            sku: d.sku || existing.sku,
            barcode: d.barcode || existing.barcode,
            sellingPrice: d.sellingPrice,
            supplierId: d.supplierId || null,
            reorderLevel: d.reorderLevel,
            active: d.active,
          },
        },
        { session, returnDocument: "after" },
      ).lean();
      if (d.costPrice === null || d.costPrice === undefined) {
        await ProductCost.deleteOne({ ...tf(c), productId: id }, { session });
      } else {
        await ProductCost.updateOne({ ...tf(c), productId: id }, { $set: { costPrice: d.costPrice } }, { upsert: true, session });
      }
      return { result: { ...view(p!), costPrice: d.costPrice ?? null }, entityId: id, audit: { before: { sellingPrice: existing.sellingPrice }, after: d } };
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", dupMessage(e));
      throw e;
    }
  });
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

  const suppliers = await Supplier.find(tf(c), { name: 1 }).lean();
  const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), String(s._id)]));
  const existing = await Product.find(tf(c), { sku: 1, barcode: 1 }).lean();
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

  const imported = await runMutation(c, { action: "product.import", entity: "product", idempotencyKey }, async (session) => {
    // Reserve counter ranges once, then insert in bulk (fast even for 5,000 rows).
    const reserve = async (name: string, n: number) => {
      if (!n) return 0;
      const doc = await Counter.findOneAndUpdate({ ...tf(c), name }, { $inc: { seq: n } }, { upsert: true, returnDocument: "after", session }).lean();
      return doc!.seq - n;
    };
    let b = await reserve("barcode", parsed.filter((d) => !d.barcode).length);
    let k = await reserve("sku", parsed.filter((d) => !d.sku).length);
    const docs = parsed.map((d) => {
      let barcode = d.barcode;
      while (!barcode || (barcode !== d.barcode && usedBarcode.has(barcode))) barcode = `BB${String(++b).padStart(8, "0")}`;
      usedBarcode.add(barcode);
      let sku = d.sku;
      while (!sku || (sku !== d.sku && usedSku.has(sku.toLowerCase()))) sku = `SKU-${String(++k).padStart(5, "0")}`;
      usedSku.add(sku.toLowerCase());
      return {
        _id: new Types.ObjectId(),
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
    try {
      await Product.insertMany(
        docs.map(({ cost: _cost, ...p }) => p),
        { session, ordered: true },
      );
    } catch (e) {
      if (isDuplicateKey(e)) throw new AppError("CONFLICT", `Import stopped: ${dupMessage(e)} Nothing was imported.`);
      throw e;
    }
    const costs = docs.filter((d) => d.cost !== null && d.cost !== undefined).map((d) => ({ ...tf(c), productId: d._id, costPrice: d.cost! }));
    if (costs.length) await ProductCost.insertMany(costs, { session });
    return { result: docs.length, audit: { count: docs.length } };
  });
  return { results, valid: parsed.length, errorCount: 0, imported };
}
