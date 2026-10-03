import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { makeShop, expectCode, expectDbError, rowCount, suspended, type TestShop } from "../helpers";
import { getDb, withTransaction } from "@/server/db";
import { applyMoves } from "@/server/stock/core";
import { receiveStock, listReceipts } from "@/server/stock/receipts";
import { getLevels, listMovements } from "@/server/stock/read";
import { createProduct, getProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";
import { stockLevels, stockMovements } from "@/server/db/stock-schema";
import { auditLogs } from "@/server/db/schema";

async function setup(s: TestShop) {
  const sup = await saveSupplier(s.manager, null, { name: "Little Threads" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "499" });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "99" });
  return { sup, p, q };
}

const qtyAt = async (s: TestShop, productId: string, locationId: string) => (await getLevels(s.owner, [productId], [locationId]))[productId]?.[locationId] ?? 0;

describe("receiveStock", () => {
  it("adds to Store Room stock and writes RECEIPT movements, a receipt and an audit entry", async () => {
    const s = await makeShop();
    const { sup, p, q } = await setup(s);
    const r = await receiveStock(s.manager, {
      supplierId: sup.id,
      invoiceNumber: "INV-1",
      lines: [
        { productId: p.id, quantity: 10, cost: 25000 },
        { productId: q.id, quantity: 4 },
        { productId: p.id, quantity: 2 }, // merged with the first line
      ],
    });
    expect(r.number).toBe("RCV-00001");
    expect(r.lines).toHaveLength(2);
    expect(await qtyAt(s, p.id, s.storeRoomId)).toBe(12);
    expect(await qtyAt(s, q.id, s.storeRoomId)).toBe(4);
    const mv = await listMovements(s.owner, { productId: p.id });
    expect(mv.rows).toHaveLength(1);
    expect(mv.rows[0]).toMatchObject({ type: "RECEIPT", quantityDelta: 12, balanceAfter: 12, refType: "receipt", refId: r.id });
    expect(await rowCount(auditLogs, and(eq(auditLogs.tenantId, s.tenantId), eq(auditLogs.action, "stock.receive")))).toBe(1);
    expect((await getProduct(s.owner, p.id)).costPrice).toBe(25000); // latest cost saved
  });

  it("is allowed for OWNER and STOREROOM_MANAGER only", async () => {
    const s = await makeShop();
    const { sup, p } = await setup(s);
    const input = { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 1 }] };
    await receiveStock(s.owner, input);
    await expectCode(receiveStock(s.staffA, input), "FORBIDDEN");
    await expectCode(receiveStock(null, input), "UNAUTHENTICATED");
    await expectCode(receiveStock(suspended(s.manager), input), "TENANT_SUSPENDED");
  });

  it("validates input (no lines, zero or fractional quantities)", async () => {
    const s = await makeShop();
    const { sup, p } = await setup(s);
    await expectCode(receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [] }), "VALIDATION");
    await expectCode(receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 0 }] }), "VALIDATION");
    await expectCode(receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 1.5 }] }), "VALIDATION");
  });

  it("cannot use another tenant's supplier or product", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const sa = await setup(a);
    const sb = await setup(b);
    await expectCode(receiveStock(a.manager, { supplierId: sb.sup.id, invoiceNumber: "I", lines: [{ productId: sa.p.id, quantity: 1 }] }), "VALIDATION");
    await expectCode(receiveStock(a.manager, { supplierId: sa.sup.id, invoiceNumber: "I", lines: [{ productId: sb.p.id, quantity: 1 }] }), "VALIDATION");
    expect(await rowCount(stockLevels, eq(stockLevels.tenantId, b.tenantId))).toBe(0);
  });

  it("is idempotent: the same key records the delivery once", async () => {
    const s = await makeShop();
    const { sup, p } = await setup(s);
    const input = { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 5 }] };
    const [r1, r2] = await Promise.all([receiveStock(s.manager, input, "k1"), receiveStock(s.manager, input, "k1")]);
    expect(r1.id).toBe(r2.id);
    expect(await qtyAt(s, p.id, s.storeRoomId)).toBe(5);
    expect((await listReceipts(s.manager)).total).toBe(1);
  });
});

describe("stock rules", () => {
  it("never goes negative: a decrement larger than stock fails with a clear message and changes nothing", async () => {
    const s = await makeShop();
    const { sup, p, q } = await setup(s);
    await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 3 }, { productId: q.id, quantity: 3 }] });
    const before = await rowCount(stockMovements, eq(stockMovements.tenantId, s.tenantId));
    let message = "";
    try {
      await withTransaction((session) =>
        applyMoves(
          s.manager,
          session,
          [
            { productId: q.id, locationId: s.storeRoomId, delta: -1, type: "DAMAGE" }, // would succeed...
            { productId: p.id, locationId: s.storeRoomId, delta: -5, type: "DAMAGE" }, // ...but this fails
          ],
          { refType: "test", refId: "1" },
        ),
      );
    } catch (e) {
      message = (e as Error).message;
      expect((e as { code?: string }).code).toBe("INSUFFICIENT_STOCK");
    }
    expect(message).toContain("Romper has 3 at Store Room, but 5 are needed");
    // Whole transaction rolled back: no partial decrement, no ledger rows.
    expect(await qtyAt(s, q.id, s.storeRoomId)).toBe(3);
    expect(await qtyAt(s, p.id, s.storeRoomId)).toBe(3);
    expect(await rowCount(stockMovements, eq(stockMovements.tenantId, s.tenantId))).toBe(before);
  });

  it("concurrent decrements cannot oversell", async () => {
    const s = await makeShop();
    const { sup, p } = await setup(s);
    await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 5 }] });
    const take = () =>
      withTransaction((session) => applyMoves(s.manager, session, [{ productId: p.id, locationId: s.storeRoomId, delta: -3, type: "DAMAGE" }], { refType: "t", refId: "x" }));
    const results = await Promise.allSettled([take(), take(), take()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await qtyAt(s, p.id, s.storeRoomId)).toBe(2);
  });

  it("every level change has a matching movement (ledger sums equal levels)", async () => {
    const s = await makeShop();
    const { sup, p, q } = await setup(s);
    await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "1", lines: [{ productId: p.id, quantity: 7 }, { productId: q.id, quantity: 2 }] });
    await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "2", lines: [{ productId: p.id, quantity: 4 }] });
    await withTransaction((session) => applyMoves(s.manager, session, [{ productId: p.id, locationId: s.storeRoomId, delta: -6, type: "DAMAGE" }], { refType: "t", refId: "x" }));
    const db = await getDb();
    const levels = await db.select().from(stockLevels).where(eq(stockLevels.tenantId, s.tenantId));
    expect(levels.length).toBeGreaterThan(0);
    for (const l of levels) {
      const moves = await db
        .select()
        .from(stockMovements)
        .where(and(eq(stockMovements.tenantId, s.tenantId), eq(stockMovements.productId, l.productId), eq(stockMovements.locationId, l.locationId)));
      expect(moves.reduce((sum, m) => sum + m.quantityDelta, 0)).toBe(l.quantity);
    }
  });

  it("the ledger is append-only", async () => {
    const s = await makeShop();
    const { sup, p } = await setup(s);
    await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 1 }] });
    // Enforced by a database trigger, so it holds for any client, not only this app.
    const db = await getDb();
    const mine = eq(stockMovements.tenantId, s.tenantId);
    await expectDbError(db.update(stockMovements).set({ quantityDelta: 100 }).where(mine), /append-only/);
    await expectDbError(db.delete(stockMovements).where(mine), /append-only/);
    await expectDbError(db.update(stockMovements).set({ note: "x" }).where(mine), /append-only/);
    expect(await rowCount(stockMovements, mine)).toBe(1);
  });

  it("rejects zero/fractional deltas and foreign locations", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const { p } = await setup(a);
    const run = (delta: number, locationId: string) =>
      withTransaction((session) => applyMoves(a.manager, session, [{ productId: p.id, locationId, delta, type: "ADJUSTMENT" }], { refType: "t", refId: "x" }));
    await expectCode(run(0, a.storeRoomId), "VALIDATION");
    await expectCode(run(1.5, a.storeRoomId), "VALIDATION");
    await expectCode(run(5, b.storeRoomId), "VALIDATION");
  });

  it("stock reads are tenant- and store-scoped", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const { sup, p } = await setup(a);
    await receiveStock(a.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: 9 }] });
    expect(await getLevels(b.owner, [p.id])).toEqual({});
    expect((await listMovements(b.owner, {})).total).toBe(0);
    // Store staff cannot read Store Room or the other store.
    await expectCode(getLevels(a.staffA, [p.id], [a.storeRoomId]), "FORBIDDEN");
    await expectCode(listMovements(a.staffA, { locationId: a.storeBId }), "FORBIDDEN");
    expect(await getLevels(a.staffA, [p.id])).toEqual({}); // own store has none yet
    expect((await listMovements(a.staffA, {})).total).toBe(0);
  });
});
