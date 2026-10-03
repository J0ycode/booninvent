import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { makeShop, expectCode, suspended, rowCount, type TestShop } from "../helpers";
import { createEntries, approveEntry, rejectEntry, listEntries } from "@/server/stock/returns";
import { applySale, recordSale } from "@/server/stock/sales";
import { rotateApiKey, getApiKeyInfo, ctxFromApiKey, revokeApiKey } from "@/server/data/apikeys";
import { saveDraft, sendDispatch, receiveDispatch } from "@/server/stock/dispatches";
import { receiveStock } from "@/server/stock/receipts";
import { getLevels, listMovements } from "@/server/stock/read";
import { createProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";
import { getDb } from "@/server/db";
import { apiKeys, tenants } from "@/server/db/schema";
import { POST as salesPOST } from "@/app/api/v1/sales/route";

/** Store Room 20 and Store A 10 of p and q. */
async function stocked(s: TestShop) {
  const sup = await saveSupplier(s.manager, null, { name: "Sup" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "1", barcode: "P-001" });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "1", barcode: "Q-001" });
  await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 30 }, { productId: q.id, quantity: 30 }] });
  const d = await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 10 }, { productId: q.id, quantity: 10 }] })).id);
  await receiveDispatch(s.staffA, d.id, { lines: d.lines.map((l) => ({ lineId: l.id, receivedQty: l.quantity, missingQty: 0, damagedQty: 0 })) });
  return { p, q };
}
const lvl = async (s: TestShop, pid: string, loc: string) => (await getLevels(s.owner, [pid], [loc]))[pid]?.[loc] ?? 0;

describe("returns and damaged", () => {
  it("store entries wait for approval; stock changes only on approval", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    const [ret] = await createEntries(s.staffA, { type: "RETURN_TO_STOREROOM", reason: "Overstock", lines: [{ productId: p.id, quantity: 3 }] });
    const [dmg] = await createEntries(s.staffA, { type: "DAMAGED", reason: "Torn", lines: [{ productId: q.id, quantity: 2 }] });
    expect(ret.status).toBe("PENDING");
    expect(await lvl(s, p.id, s.storeAId)).toBe(10);
    await expectCode(approveEntry(s.staffA, ret.id), "FORBIDDEN");
    await approveEntry(s.manager, ret.id);
    expect(await lvl(s, p.id, s.storeAId)).toBe(7);
    expect(await lvl(s, p.id, s.storeRoomId)).toBe(23);
    await approveEntry(s.owner, dmg.id);
    expect(await lvl(s, q.id, s.storeAId)).toBe(8);
    const mv = await listMovements(s.owner, { productId: p.id, types: ["RETURN_OUT", "RETURN_IN"] });
    expect(mv.rows.map((m) => m.quantityDelta).sort()).toEqual([-3, 3]);
    await expectCode(approveEntry(s.manager, ret.id), "INVALID_STATE");
  });

  it("rejecting changes no stock and needs a reason", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    const [e] = await createEntries(s.staffA, { type: "DAMAGED", reason: "Torn", lines: [{ productId: p.id, quantity: 1 }] });
    await expectCode(rejectEntry(s.manager, e.id, { note: "" }), "VALIDATION");
    const r = await rejectEntry(s.manager, e.id, { note: "Not damaged" });
    expect(r.status).toBe("REJECTED");
    expect(await lvl(s, p.id, s.storeAId)).toBe(10);
  });

  it("cannot return more than the store has (on request and on approval)", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    await expectCode(createEntries(s.staffA, { type: "DAMAGED", reason: "x y", lines: [{ productId: p.id, quantity: 11 }] }), "INSUFFICIENT_STOCK");
    const [e] = await createEntries(s.staffA, { type: "DAMAGED", reason: "x y", lines: [{ productId: p.id, quantity: 10 }] });
    await applySale(s.owner, { locationId: s.storeAId, externalRef: "S1", items: [{ barcode: "P-001", quantity: 5 }] }, "INTERNAL");
    await expectCode(approveEntry(s.manager, e.id), "INSUFFICIENT_STOCK");
  });

  it("Store Room damage / supplier return apply immediately; staff cannot return to supplier", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    await createEntries(s.manager, { type: "DAMAGED", reason: "Water", lines: [{ productId: p.id, quantity: 2 }] });
    await createEntries(s.owner, { type: "SUPPLIER_RETURN", reason: "Wrong size", lines: [{ productId: q.id, quantity: 5 }] });
    expect(await lvl(s, p.id, s.storeRoomId)).toBe(18);
    expect(await lvl(s, q.id, s.storeRoomId)).toBe(15);
    await expectCode(createEntries(s.staffA, { type: "SUPPLIER_RETURN", reason: "x y", lines: [{ productId: p.id, quantity: 1 }] }), "FORBIDDEN");
    await expectCode(createEntries(s.manager, { type: "RETURN_TO_STOREROOM", reason: "x y", lines: [{ productId: p.id, quantity: 1 }] }), "VALIDATION");
  });

  it("store staff only see their own store's entries; other tenants see none", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    const { p } = await stocked(s);
    const [e] = await createEntries(s.staffA, { type: "DAMAGED", reason: "x y", lines: [{ productId: p.id, quantity: 1 }] });
    expect((await listEntries(s.staffB)).total).toBe(0);
    expect((await listEntries(other.owner)).total).toBe(0);
    await expectCode(approveEntry(other.manager, e.id), "NOT_FOUND");
  });
});

describe("sales", () => {
  it("reduces the store's stock, is idempotent on externalRef, merges repeated barcodes", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    const body = { locationId: s.storeAId, externalRef: "BILL-1", items: [{ barcode: "P-001", quantity: 2 }, { barcode: "Q-001", quantity: 1 }, { barcode: "P-001", quantity: 1 }] };
    const r1 = await applySale(s.owner, body, "INTERNAL");
    expect(r1.duplicate).toBe(false);
    expect(r1.items.find((i) => i.productId === p.id)).toMatchObject({ quantity: 3, balanceAfter: 7 });
    const [r2, r3] = await Promise.all([applySale(s.owner, body, "INTERNAL"), applySale(s.owner, body, "INTERNAL")]);
    expect(r2.duplicate && r3.duplicate).toBe(true);
    expect(r2.saleId).toBe(r1.saleId);
    expect(await lvl(s, p.id, s.storeAId)).toBe(7);
    expect(await lvl(s, q.id, s.storeAId)).toBe(9);
  });

  it("clear errors: unknown barcode, Store Room as location, insufficient stock (nothing changes)", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    await expectCode(applySale(s.owner, { locationId: s.storeAId, externalRef: "X1", items: [{ barcode: "NOPE", quantity: 1 }] }, "API"), "UNKNOWN_BARCODE");
    await expectCode(applySale(s.owner, { locationId: s.storeRoomId, externalRef: "X2", items: [{ barcode: "P-001", quantity: 1 }] }, "API"), "INVALID_LOCATION");
    await expectCode(
      applySale(s.owner, { locationId: s.storeAId, externalRef: "X3", items: [{ barcode: "Q-001", quantity: 1 }, { barcode: "P-001", quantity: 99 }] }, "API"),
      "INSUFFICIENT_STOCK",
    );
    expect(await lvl(s, p.id, s.storeAId)).toBe(10);
    // A failed sale does not burn the externalRef.
    const ok = await applySale(s.owner, { locationId: s.storeAId, externalRef: "X3", items: [{ barcode: "P-001", quantity: 1 }] }, "API");
    expect(ok.duplicate).toBe(false);
    await expectCode(applySale(s.owner, { locationId: s.storeAId, externalRef: "", items: [] }, "API"), "VALIDATION");
  });

  it("internal recordSale: staff only from their own store; manager cannot sell", async () => {
    const s = await makeShop();
    await stocked(s);
    await expectCode(recordSale(s.staffB, { locationId: s.storeAId, externalRef: "A", items: [{ barcode: "P-001", quantity: 1 }] }), "FORBIDDEN");
    await expectCode(recordSale(s.manager, { locationId: s.storeAId, externalRef: "A", items: [{ barcode: "P-001", quantity: 1 }] }), "FORBIDDEN");
    const r = await recordSale(s.staffA, { locationId: s.storeAId, externalRef: "A", items: [{ barcode: "P-001", quantity: 1 }] });
    expect(r.duplicate).toBe(false);
  });

  it("suspended shops cannot sell", async () => {
    const s = await makeShop();
    await stocked(s);
    await expectCode(applySale(suspended(s.owner), { locationId: s.storeAId, externalRef: "Z", items: [{ barcode: "P-001", quantity: 1 }] }, "API"), "TENANT_SUSPENDED");
  });
});

describe("POST /api/v1/sales", () => {
  const call = (key: string | null, body: unknown) =>
    salesPOST(
      new Request("http://test/api/v1/sales", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(body),
      }),
    );

  it("401 without/invalid key; 201 then 200 duplicate; key is stored hashed; rotation revokes the old key", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await stocked(s);
    const body = { locationId: s.storeAId, externalRef: "POS-77", items: [{ barcode: "P-001", quantity: 2 }] };
    expect((await call(null, body)).status).toBe(401);
    expect((await call("bbk_wrong", body)).status).toBe(401);

    await expectCode(rotateApiKey(s.manager), "FORBIDDEN");
    const { key } = await rotateApiKey(s.owner);
    expect(await rowCount(apiKeys, eq(apiKeys.keyHash, key))).toBe(0); // never stored in plain text
    expect((await getApiKeyInfo(s.owner))?.prefix).toBe(key.slice(0, 12));

    const r1 = await call(key, body);
    expect(r1.status).toBe(201);
    const j1 = await r1.json();
    expect(j1).toMatchObject({ externalRef: "POS-77", duplicate: false });
    const r2 = await call(key, body);
    expect(r2.status).toBe(200);
    expect((await r2.json()).saleId).toBe(j1.saleId);

    const bad = await call(key, { ...body, externalRef: "POS-78", items: [{ barcode: "NOPE", quantity: 1 }] });
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe("UNKNOWN_BARCODE");

    // A key can never touch another tenant's store.
    const cross = await call(key, { ...body, externalRef: "POS-79", locationId: other.storeAId });
    expect((await cross.json()).error.code).toBe("INVALID_LOCATION");

    const { key: key2 } = await rotateApiKey(s.owner);
    expect((await call(key, { ...body, externalRef: "POS-80" })).status).toBe(401);
    expect((await call(key2, { ...body, externalRef: "POS-80" })).status).toBe(201);
    await revokeApiKey(s.owner);
    expect(await ctxFromApiKey(key2)).toBeNull();
  });

  it("423 for a suspended shop", async () => {
    const s = await makeShop();
    await stocked(s);
    const { key } = await rotateApiKey(s.owner);
    await (await getDb()).update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, s.tenantId));
    const r = await call(key, { locationId: s.storeAId, externalRef: "S", items: [{ barcode: "P-001", quantity: 1 }] });
    expect(r.status).toBe(423);
  });
});
