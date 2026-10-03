import { describe, it, expect } from "vitest";
import { makeShop, expectCode, type TestShop } from "../helpers";
import { saveDraft, sendDispatch, receiveDispatch, resolveDiscrepancy, listDispatches, getDispatch, discardDraft } from "@/server/stock/dispatches";
import { receiveStock } from "@/server/stock/receipts";
import { getLevels, listMovements } from "@/server/stock/read";
import { createProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";

async function stocked(s: TestShop, qty = 10) {
  const sup = await saveSupplier(s.manager, null, { name: "Sup" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "499" });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "99" });
  await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "I", lines: [{ productId: p.id, quantity: qty }, { productId: q.id, quantity: qty }] });
  return { p, q };
}
const level = async (s: TestShop, pid: string, loc: string) => (await getLevels(s.owner, [pid], [loc]))[pid]?.[loc] ?? 0;

describe("dispatch", () => {
  it("draft moves no stock; send deducts Store Room (DISPATCH_OUT)", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    const d = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 4 }, { productId: q.id, quantity: 2 }] });
    expect(d.status).toBe("DRAFT");
    expect(await level(s, p.id, s.storeRoomId)).toBe(10);
    const sent = await sendDispatch(s.manager, d.id);
    expect(sent.status).toBe("DISPATCHED");
    expect(await level(s, p.id, s.storeRoomId)).toBe(6);
    expect(await level(s, p.id, s.storeAId)).toBe(0); // in transit, not yet at the store
    const mv = await listMovements(s.owner, { productId: p.id, types: ["DISPATCH_OUT"] });
    expect(mv.rows[0]).toMatchObject({ quantityDelta: -4, refType: "dispatch", refId: d.id });
  });

  it("cannot send more than the Store Room has; nothing changes", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s, 3);
    const d = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: q.id, quantity: 1 }, { productId: p.id, quantity: 5 }] });
    await expectCode(sendDispatch(s.manager, d.id), "INSUFFICIENT_STOCK");
    expect((await getDispatch(s.manager, d.id)).status).toBe("DRAFT");
    expect(await level(s, q.id, s.storeRoomId)).toBe(3);
  });

  it("can only be sent once, even with retries or a double click", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    const d = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 4 }] });
    const results = await Promise.allSettled([sendDispatch(s.manager, d.id), sendDispatch(s.manager, d.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await level(s, p.id, s.storeRoomId)).toBe(6);
    await expectCode(sendDispatch(s.manager, d.id), "INVALID_STATE");
    await expectCode(saveDraft(s.manager, d.id, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 1 }] }), "INVALID_STATE");
  });

  it("full receipt adds good pieces to the store (DISPATCH_IN) and marks Received", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    const d = await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 4 }] })).id);
    const r = await receiveDispatch(s.staffA, d.id, { lines: [{ lineId: d.lines[0].id, receivedQty: 4, missingQty: 0, damagedQty: 0 }] });
    expect(r.status).toBe("RECEIVED");
    expect(await level(s, p.id, s.storeAId)).toBe(4);
    await expectCode(receiveDispatch(s.staffA, d.id, { lines: [{ lineId: d.lines[0].id, receivedQty: 4, missingQty: 0, damagedQty: 0 }] }), "INVALID_STATE");
  });

  it("missing/damaged → Received with issues; quantities must add up and need a note", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    const d = await sendDispatch(
      s.manager,
      (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 5 }, { productId: q.id, quantity: 3 }] })).id,
    );
    const [lp, lq] = d.lines;
    await expectCode(
      receiveDispatch(s.staffA, d.id, { lines: [{ lineId: lp.id, receivedQty: 3, missingQty: 1, damagedQty: 0, note: "x" }, { lineId: lq.id, receivedQty: 3, missingQty: 0, damagedQty: 0 }] }),
      "VALIDATION",
    ); // 3+1 != 5
    await expectCode(
      receiveDispatch(s.staffA, d.id, { lines: [{ lineId: lp.id, receivedQty: 3, missingQty: 1, damagedQty: 1 }, { lineId: lq.id, receivedQty: 3, missingQty: 0, damagedQty: 0 }] }),
      "VALIDATION",
    ); // note required
    const r = await receiveDispatch(s.staffA, d.id, {
      lines: [
        { lineId: lp.id, receivedQty: 3, missingQty: 1, damagedQty: 1, note: "1 torn, 1 missing" },
        { lineId: lq.id, receivedQty: 3, missingQty: 0, damagedQty: 0 },
      ],
    });
    expect(r.status).toBe("RECEIVED_WITH_ISSUES");
    expect(r.openIssues).toBe(1);
    expect(await level(s, p.id, s.storeAId)).toBe(3);
    // Shows in the Store Room's discrepancy list.
    expect((await listDispatches(s.manager, { status: "RECEIVED_WITH_ISSUES" })).total).toBe(1);
  });

  it("resolving: RETURN adds back to Store Room; WRITE_OFF records RETURN_IN + DAMAGE (net zero); then Resolved", async () => {
    const s = await makeShop();
    const { p, q } = await stocked(s);
    const d = await sendDispatch(
      s.manager,
      (await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 5 }, { productId: q.id, quantity: 5 }] })).id,
    );
    await receiveDispatch(s.staffA, d.id, {
      lines: [
        { lineId: d.lines[0].id, receivedQty: 3, missingQty: 2, damagedQty: 0, note: "short" },
        { lineId: d.lines[1].id, receivedQty: 4, missingQty: 0, damagedQty: 1, note: "torn" },
      ],
    });
    await expectCode(resolveDiscrepancy(s.staffA, d.id, { lineId: d.lines[0].id, action: "RETURN" }), "FORBIDDEN");
    const r1 = await resolveDiscrepancy(s.manager, d.id, { lineId: d.lines[0].id, action: "RETURN" });
    expect(r1.status).toBe("RECEIVED_WITH_ISSUES");
    expect(await level(s, p.id, s.storeRoomId)).toBe(5 + 2);
    const r2 = await resolveDiscrepancy(s.owner, d.id, { lineId: d.lines[1].id, action: "WRITE_OFF", note: "bin" });
    expect(r2.status).toBe("RESOLVED");
    expect(await level(s, q.id, s.storeRoomId)).toBe(5);
    const mv = await listMovements(s.owner, { productId: q.id, locationId: s.storeRoomId, types: ["RETURN_IN", "DAMAGE"] });
    expect(mv.rows.map((m) => m.quantityDelta).sort()).toEqual([-1, 1]);
    await expectCode(resolveDiscrepancy(s.manager, d.id, { lineId: d.lines[1].id, action: "RETURN" }), "INVALID_STATE");
  });

  it("store staff only see and receive their own store's dispatches, never drafts", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    const draft = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 1 }] });
    expect((await listDispatches(s.staffA)).total).toBe(0);
    await expectCode(getDispatch(s.staffA, draft.id), "NOT_FOUND");
    const toB = await sendDispatch(s.manager, (await saveDraft(s.manager, null, { toLocationId: s.storeBId, lines: [{ productId: p.id, quantity: 2 }] })).id);
    expect((await listDispatches(s.staffA)).total).toBe(0);
    await expectCode(getDispatch(s.staffA, toB.id), "NOT_FOUND");
    await expectCode(receiveDispatch(s.staffA, toB.id, { lines: [{ lineId: toB.lines[0].id, receivedQty: 2, missingQty: 0, damagedQty: 0 }] }), "NOT_FOUND");
    expect((await listDispatches(s.staffB)).total).toBe(1);
    await expectCode(saveDraft(s.staffA, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 1 }] }), "FORBIDDEN");
    await expectCode(sendDispatch(s.staffA, draft.id), "FORBIDDEN");
  });

  it("only goes to stores of the same tenant", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const { p } = await stocked(a);
    await expectCode(saveDraft(a.manager, null, { toLocationId: b.storeAId, lines: [{ productId: p.id, quantity: 1 }] }), "VALIDATION");
    await expectCode(saveDraft(a.manager, null, { toLocationId: a.storeRoomId, lines: [{ productId: p.id, quantity: 1 }] }), "VALIDATION");
    const d = await saveDraft(a.manager, null, { toLocationId: a.storeAId, lines: [{ productId: p.id, quantity: 1 }] });
    await expectCode(getDispatch(b.owner, d.id), "NOT_FOUND");
    await expectCode(sendDispatch(b.manager, d.id), "NOT_FOUND");
  });

  it("drafts can be discarded; sent dispatches cannot", async () => {
    const s = await makeShop();
    const { p } = await stocked(s);
    const d = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 1 }] });
    await discardDraft(s.manager, d.id);
    await expectCode(getDispatch(s.manager, d.id), "NOT_FOUND");
    const d2 = await saveDraft(s.manager, null, { toLocationId: s.storeAId, lines: [{ productId: p.id, quantity: 1 }] });
    await sendDispatch(s.manager, d2.id);
    await expectCode(discardDraft(s.manager, d2.id), "INVALID_STATE");
  });
});
