import { describe, it, expect } from "vitest";
import { makeShop, expectCode, platformAdmin, type TestShop } from "../helpers";
import { storeroomDashboard, storeDashboard, ownerDashboard, notifications, setupChecklist } from "@/server/data/dashboard";
import { buildReport } from "@/server/data/reports";
import { stockAtLocation, lowStockCountAt } from "@/server/stock/read";
import { receiveStock } from "@/server/stock/receipts";
import { saveDraft, sendDispatch } from "@/server/stock/dispatches";
import { createProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";

async function setup(s: TestShop) {
  const sup = await saveSupplier(s.manager, null, { name: "Sup" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "100", costPrice: "55", reorderLevel: 5 });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "50", reorderLevel: 2 });
  await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 20 }] });
  return { p, q };
}

describe("dashboards", () => {
  it("Store Room counts include never-received products as low stock", async () => {
    const s = await makeShop();
    await setup(s);
    const d = await storeroomDashboard(s.manager);
    expect(d).toMatchObject({ products: 2, pieces: 20, low: 1 }); // Bib has no stock row → 0 ≤ 2
    expect(await lowStockCountAt(s.owner, s.storeAId, false)).toBe(0); // stores only count what they carry
  });

  it("store dashboard shows only the staff's store; incoming dispatches counted", async () => {
    const s = await makeShop();
    const { p } = await setup(s);
    await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 3 }] })).id);
    expect((await storeDashboard(s.staffA)).incoming).toBe(1);
    expect((await storeDashboard(s.staffB)).incoming).toBe(0);
    await expectCode(storeDashboard(s.owner), "FORBIDDEN");
    await expectCode(storeroomDashboard(s.staffA), "FORBIDDEN");
    await expectCode(ownerDashboard(s.manager), "FORBIDDEN");
  });

  it("owner dashboard compares every location; other tenants never appear", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await setup(s);
    await setup(other);
    const d = await ownerDashboard(s.owner);
    expect(d.locations.map((l) => l.id).sort()).toEqual([s.storeRoomId, s.storeAId, s.storeBId].sort());
    expect(d.locations.find((l) => l.id === s.storeRoomId)!.pieces).toBe(20);
  });

  it("first-run checklist reflects progress", async () => {
    const s = await makeShop();
    const before = await setupChecklist(s.owner);
    expect(before.find((c) => c.label.includes("suppliers"))!.done).toBe(false);
    await setup(s);
    const after = await setupChecklist(s.owner);
    expect(after.filter((c) => c.done).length).toBeGreaterThan(before.filter((c) => c.done).length);
  });

  it("notifications are per role", async () => {
    const s = await makeShop();
    const { p } = await setup(s);
    await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 3 }] })).id);
    expect((await notifications(s.staffA)).map((n) => n.key)).toContain("incoming");
    expect((await notifications(s.staffB)).map((n) => n.key)).not.toContain("incoming");
    expect((await notifications(s.manager)).map((n) => n.key)).toContain("low");
    expect(await notifications(await platformAdmin())).toEqual([]);
    expect(await notifications(null)).toEqual([]);
  });
});

describe("My Stock", () => {
  it("paginates, searches and stays inside the staff's store", async () => {
    const s = await makeShop();
    const { p } = await setup(s);
    const d = await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 3 }] })).id);
    void d;
    await expectCode(stockAtLocation(s.staffA, s.storeBId), "FORBIDDEN");
    await expectCode(stockAtLocation(s.staffA, s.storeRoomId), "FORBIDDEN");
    const sr = await stockAtLocation(s.manager, s.storeRoomId, { q: "romp" });
    expect(sr.rows.map((r) => r.quantity)).toEqual([17]);
    expect(sr.rows[0]).not.toHaveProperty("costPrice");
  });
});

describe("reports", () => {
  it("every report builds for managers and is refused for store staff", async () => {
    const s = await makeShop();
    await setup(s);
    for (const type of ["stock", "low", "dispatches", "returns", "movements", "bills"]) {
      const r = await buildReport(s.manager, { type });
      expect(r.columns.length).toBeGreaterThan(0);
      await expectCode(buildReport(s.staffA, { type }), "FORBIDDEN");
    }
    const stock = await buildReport(s.owner, { type: "stock" });
    expect(stock.rows.find((r) => r.name === "Romper")).toMatchObject({ cost: "55.00", total: 20 });
  });

  it("location filter ignores ids from another tenant; data never crosses tenants", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await setup(s);
    const r = await buildReport(other.owner, { type: "movements", location: s.storeRoomId });
    expect(r.rows).toHaveLength(0);
    const st = await buildReport(other.owner, { type: "stock" });
    expect(st.rows).toHaveLength(0);
  });
});
