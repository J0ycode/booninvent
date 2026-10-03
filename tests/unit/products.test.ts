import { describe, it, expect } from "vitest";
import { makeShop, expectCode, suspended } from "../helpers";
import { createProduct, updateProduct, listProducts, getProduct, findByCode, importProducts, getProductsByIds } from "@/server/data/products";
import { saveSupplier, listSuppliers } from "@/server/data/suppliers";
import { ProductCost } from "@/server/models/business";

const romper = { name: "Cotton Romper 0-3M", category: "CLOTHING", sellingPrice: "499", costPrice: "250", reorderLevel: 5 };

describe("products", () => {
  it("auto-creates a unique Code 128 barcode and SKU, stores prices in paise", async () => {
    const s = await makeShop();
    const a = await createProduct(s.manager, romper);
    const b = await createProduct(s.manager, { ...romper, name: "Romper 2" });
    expect(a.barcode).toMatch(/^BB\d{8}$/);
    expect(a.barcode).not.toBe(b.barcode);
    expect(a.sku).toMatch(/^SKU-\d{5}$/);
    expect(a.sellingPrice).toBe(49900);
    expect(a.costPrice).toBe(25000);
  });

  it("keeps an entered barcode and rejects duplicates within a tenant only", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await createProduct(s.manager, { ...romper, barcode: "8901234567890" });
    await expectCode(createProduct(s.manager, { ...romper, name: "Dup", barcode: "8901234567890" }), "CONFLICT");
    const ok = await createProduct(other.manager, { ...romper, barcode: "8901234567890" });
    expect(ok.barcode).toBe("8901234567890");
  });

  it("STORE_STAFF never receive cost price (list, get, scan lookup, by ids)", async () => {
    const s = await makeShop();
    const p = await createProduct(s.manager, romper);
    const list = await listProducts(s.staffA, {});
    expect(list.rows[0]).not.toHaveProperty("costPrice");
    expect(await getProduct(s.staffA, p.id)).not.toHaveProperty("costPrice");
    expect(await findByCode(s.staffA, p.barcode)).not.toHaveProperty("costPrice");
    expect((await getProductsByIds(s.staffA, [p.id])).get(p.id)).not.toHaveProperty("costPrice");
    expect(JSON.stringify(list)).not.toContain("25000");
    // Managers do see it.
    expect((await getProduct(s.owner, p.id)).costPrice).toBe(25000);
  });

  it("only managers can create or edit products and suppliers", async () => {
    const s = await makeShop();
    await expectCode(createProduct(s.staffA, romper), "FORBIDDEN");
    await expectCode(saveSupplier(s.staffA, null, { name: "X Supplies" }), "FORBIDDEN");
    await expectCode(listSuppliers(s.staffA), "FORBIDDEN");
    await expectCode(createProduct(null, romper), "UNAUTHENTICATED");
  });

  it("is isolated per tenant", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const pa = await createProduct(a.manager, romper);
    expect((await listProducts(b.owner, {})).total).toBe(0);
    await expectCode(getProduct(b.owner, pa.id), "NOT_FOUND");
    expect(await findByCode(b.owner, pa.barcode)).toBeNull();
    await expectCode(updateProduct(b.manager, pa.id, romper), "NOT_FOUND");
    expect(await ProductCost.countDocuments({ tenantId: b.tenantId })).toBe(0);
  });

  it("rejects a supplier from another tenant", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const sb = await saveSupplier(b.manager, null, { name: "B Supplies" });
    await expectCode(createProduct(a.manager, { ...romper, supplierId: sb.id }), "VALIDATION");
  });

  it("search matches name, SKU prefix and exact barcode; inactive hidden from staff", async () => {
    const s = await makeShop();
    const p = await createProduct(s.manager, romper);
    await createProduct(s.manager, { ...romper, name: "Baby Bib", category: "ACCESSORY" });
    expect((await listProducts(s.owner, { q: "romp" })).rows.map((r) => r.id)).toEqual([p.id]);
    expect((await listProducts(s.owner, { q: p.barcode })).rows.map((r) => r.id)).toEqual([p.id]);
    expect((await listProducts(s.owner, { q: p.sku.slice(0, 6) })).total).toBeGreaterThan(0);
    await updateProduct(s.manager, p.id, { ...romper, active: false });
    expect((await listProducts(s.staffA, { q: "romp" })).total).toBe(0);
    expect(await findByCode(s.staffA, p.barcode)).toBeNull();
  });

  it("paginates on the server", async () => {
    const s = await makeShop();
    const rows = Array.from({ length: 30 }, (_, i) => ({ name: `Item ${String(i).padStart(2, "0")}`, category: "Accessory", sellingPrice: "10" }));
    await importProducts(s.manager, rows, true);
    const p1 = await listProducts(s.owner, { page: 1, pageSize: 25 });
    const p2 = await listProducts(s.owner, { page: 2, pageSize: 25 });
    expect(p1.rows.length).toBe(25);
    expect(p2.rows.length).toBe(5);
    expect(p1.total).toBe(30);
  });

  it("suspended shops cannot write", async () => {
    const s = await makeShop();
    await expectCode(createProduct(suspended(s.manager), romper), "TENANT_SUSPENDED");
  });
});

describe("CSV import", () => {
  it("previews errors and imports nothing until every row is valid", async () => {
    const s = await makeShop();
    await saveSupplier(s.manager, null, { name: "Little Threads" });
    const rows = [
      { name: "Romper", category: "Clothing", sellingPrice: "499", costPrice: "250", supplier: "Little Threads" },
      { name: "", category: "Clothing", sellingPrice: "10" },
      { name: "Hat", category: "Shoes", sellingPrice: "abc" },
      { name: "Bib", category: "accessory", sellingPrice: "99", supplier: "Unknown Co" },
      { name: "Dup1", category: "Clothing", sellingPrice: "1", sku: "S1" },
      { name: "Dup2", category: "Clothing", sellingPrice: "1", sku: "S1" },
    ];
    const preview = await importProducts(s.manager, rows, false);
    expect(preview.results.filter((r) => r.errors.length).map((r) => r.row)).toEqual([2, 3, 4, 6]);
    const tried = await importProducts(s.manager, rows, true);
    expect(tried.imported).toBe(0);
    expect((await listProducts(s.owner, {})).total).toBe(0);
  });

  it("imports valid rows with costs, auto codes, and keeps given codes", async () => {
    const s = await makeShop();
    const res = await importProducts(
      s.manager,
      [
        { Name: "Romper", Category: "Clothing", "Selling Price": "499", "Cost Price": "250", Barcode: "123456" },
        { name: "Bib", category: "Accessory", sellingPrice: "99" },
      ],
      true,
    );
    expect(res.imported).toBe(2);
    const list = await listProducts(s.owner, {});
    const romperRow = list.rows.find((r) => r.name === "Romper")!;
    expect(romperRow.barcode).toBe("123456");
    expect(romperRow.costPrice).toBe(25000);
    expect(list.rows.find((r) => r.name === "Bib")!.barcode).toMatch(/^BB\d{8}$/);
  });

  it("rejects store staff and too many rows", async () => {
    const s = await makeShop();
    await expectCode(importProducts(s.staffA, [{ name: "x" }], false), "FORBIDDEN");
    await expectCode(importProducts(s.manager, Array.from({ length: 5001 }, () => ({})), false), "VALIDATION");
  });
});
