import { describe, it, expect } from "vitest";
import { makeShop, expectCode, type TestShop } from "../helpers";
import {
  createManualRequest,
  suggestRestock,
  decideSuggestedLine,
  forwardRequest,
  approveRequest,
  rejectRequest,
  listRequests,
  getRequest,
  discardSuggestion,
} from "@/server/data/restock";
import { saveDraft, sendDispatch, receiveDispatch, getDispatch } from "@/server/stock/dispatches";
import { receiveStock } from "@/server/stock/receipts";
import { createProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";

/** Store A has: p at 2 (reorder 5), q at 10 (reorder 5), r at 1 (reorder 3). */
async function scenario(s: TestShop) {
  const sup = await saveSupplier(s.manager, null, { name: "Sup" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "1", reorderLevel: 5 });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "1", reorderLevel: 5 });
  const r = await createProduct(s.manager, { name: "Cap", category: "CLOTHING", sellingPrice: "1", reorderLevel: 3 });
  await receiveStock(s.manager, {
    supplierId: sup.id,
    invoiceNumber: "I",
    lines: [
      { productId: p.id, quantity: 50 },
      { productId: q.id, quantity: 50 },
      { productId: r.id, quantity: 50 },
    ],
  });
  const d = await sendDispatch(
    s.manager,
    (
      await saveDraft(s.manager, null, {
        toLocationId: s.storeAId,
        lines: [
          { productId: p.id, quantity: 2 },
          { productId: q.id, quantity: 10 },
          { productId: r.id, quantity: 1 },
        ],
      })
    ).id,
  );
  await receiveDispatch(s.staffA, d.id, { lines: d.lines.map((l) => ({ lineId: l.id, receivedQty: l.quantity, missingQty: 0, damagedQty: 0 })) });
  return { p, q, r };
}

describe("restock requests", () => {
  it("suggest: lists products at/below reorder with qty = max(1, reorder*2 - current)", async () => {
    const s = await makeShop();
    const { p, q, r } = await scenario(s);
    const sug = (await suggestRestock(s.staffA))!;
    expect(sug.status).toBe("WAITING_STAFF_APPROVAL");
    const byProduct = Object.fromEntries(sug.lines.map((l) => [l.productId, l]));
    expect(byProduct[p.id].quantity).toBe(8); // 5*2 - 2
    expect(byProduct[q.id]).toBeUndefined(); // 10 > 5
    expect(byProduct[r.id].quantity).toBe(5); // 3*2 - 1
    expect(sug.lines.every((l) => l.lineStatus === "PENDING")).toBe(true);
  });

  it("suggestions are private until forwarded, and need every line reviewed", async () => {
    const s = await makeShop();
    const { p, r } = await scenario(s);
    const sug = (await suggestRestock(s.staffA))!;
    expect((await listRequests(s.manager, {})).total).toBe(0);
    await expectCode(getRequest(s.manager, sug.id), "NOT_FOUND");
    await expectCode(getRequest(s.staffB, sug.id), "NOT_FOUND");
    await expectCode(forwardRequest(s.staffA, sug.id), "VALIDATION");
    const lp = sug.lines.find((l) => l.productId === p.id)!;
    const lr = sug.lines.find((l) => l.productId === r.id)!;
    await decideSuggestedLine(s.staffA, sug.id, { lineId: lp.id, action: "APPROVE", quantity: 12 }); // edit
    await decideSuggestedLine(s.staffA, sug.id, { lineId: lr.id, action: "SKIP" });
    const sent = await forwardRequest(s.staffA, sug.id);
    expect(sent.status).toBe("SENT");
    expect(sent.approvedPieces).toBe(12);
    expect((await listRequests(s.manager, {})).total).toBe(1);
    await expectCode(decideSuggestedLine(s.staffA, sug.id, { lineId: lp.id, action: "SKIP" }), "INVALID_STATE");
  });

  it("all lines skipped cannot be forwarded; a new suggestion replaces an unforwarded one", async () => {
    const s = await makeShop();
    await scenario(s);
    const a = (await suggestRestock(s.staffA))!;
    for (const l of a.lines) await decideSuggestedLine(s.staffA, a.id, { lineId: l.id, action: "SKIP" });
    await expectCode(forwardRequest(s.staffA, a.id), "VALIDATION");
    const b = (await suggestRestock(s.staffA))!;
    await expectCode(getRequest(s.staffA, a.id), "NOT_FOUND");
    await discardSuggestion(s.staffA, b.id);
    expect((await listRequests(s.staffA, {})).total).toBe(0);
  });

  it("manual request goes straight to the Store Room; approve creates a pre-filled draft dispatch; sending marks it Dispatched", async () => {
    const s = await makeShop();
    const { p, q } = await scenario(s);
    const req = await createManualRequest(s.staffA, { lines: [{ productId: p.id, quantity: 4 }, { productId: q.id, quantity: 1 }, { productId: p.id, quantity: 1 }] });
    expect(req.status).toBe("SENT");
    expect(req.lines).toHaveLength(2);
    const { request, dispatchId } = await approveRequest(s.manager, req.id);
    expect(request.status).toBe("APPROVED");
    const draft = await getDispatch(s.manager, dispatchId);
    expect(draft.status).toBe("DRAFT");
    expect(draft.toLocationId).toBe(s.storeAId);
    expect(Object.fromEntries(draft.lines.map((l) => [l.productId, l.quantity]))).toEqual({ [p.id]: 5, [q.id]: 1 });
    await sendDispatch(s.manager, dispatchId);
    expect((await getRequest(s.staffA, req.id)).status).toBe("DISPATCHED");
    await expectCode(approveRequest(s.manager, req.id), "INVALID_STATE");
  });

  it("reject needs a reason; roles are enforced", async () => {
    const s = await makeShop();
    const { p } = await scenario(s);
    const req = await createManualRequest(s.staffA, { lines: [{ productId: p.id, quantity: 4 }] });
    await expectCode(approveRequest(s.staffA, req.id), "FORBIDDEN");
    await expectCode(createManualRequest(s.manager, { lines: [{ productId: p.id, quantity: 4 }] }), "FORBIDDEN");
    await expectCode(suggestRestock(s.owner), "FORBIDDEN");
    await expectCode(rejectRequest(s.manager, req.id, { reason: "" }), "VALIDATION");
    const rej = await rejectRequest(s.manager, req.id, { reason: "Out of stock" });
    expect(rej.status).toBe("REJECTED");
    expect((await getRequest(s.staffA, req.id)).rejectReason).toBe("Out of stock");
  });

  it("isolation: other stores and tenants never see a request", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    const { p } = await scenario(s);
    const req = await createManualRequest(s.staffA, { lines: [{ productId: p.id, quantity: 4 }] });
    expect((await listRequests(s.staffB, {})).total).toBe(0);
    await expectCode(getRequest(s.staffB, req.id), "NOT_FOUND");
    await expectCode(getRequest(other.manager, req.id), "NOT_FOUND");
    await expectCode(approveRequest(other.manager, req.id), "NOT_FOUND");
    await expectCode(listRequests(s.staffA, { locationId: s.storeBId }), "FORBIDDEN");
    // A product of another tenant cannot be requested.
    const foreign = await createProduct(other.manager, { name: "X", category: "CLOTHING", sellingPrice: "1" });
    await expectCode(createManualRequest(s.staffA, { lines: [{ productId: foreign.id, quantity: 1 }] }), "VALIDATION");
  });
});
