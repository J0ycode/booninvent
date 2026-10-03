import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { makeShop, expectCode } from "../helpers";
import { labelsPdf } from "@/server/pdf/labels";
import { createProduct } from "@/server/data/products";
import { LabelPrintLog } from "@/server/models/business";
import { LABEL_PRESETS, slotPosition, A4 } from "@/lib/label-presets";

describe("label sheets", () => {
  it("every preset fits on A4", () => {
    for (const p of Object.values(LABEL_PRESETS)) {
      expect(p.cols * p.rows).toBe(p.perSheet);
      const last = slotPosition(p, p.perSheet - 1);
      expect(last.x + p.width).toBeLessThanOrEqual(A4.width + 0.01);
      expect(last.y + p.height).toBeLessThanOrEqual(A4.height + 0.01);
    }
  });

  it("builds a PDF across sheets from the start position and logs the print", async () => {
    const s = await makeShop();
    const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "499" });
    const bytes = await labelsPdf(s.manager, { preset: 24, startPosition: 20, items: [{ productId: p.id, count: 10 }] });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2); // 5 slots left on sheet 1, 5 on sheet 2
    const log = await LabelPrintLog.findOne({ tenantId: s.tenantId }).lean();
    expect(log).toMatchObject({ preset: 24, startPosition: 20, totalLabels: 10 });
  });

  it("validates input and roles; cannot print another tenant's product", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "499" });
    await expectCode(labelsPdf(s.manager, { preset: 24, startPosition: 25, items: [{ productId: p.id, count: 1 }] }), "VALIDATION");
    await expectCode(labelsPdf(s.manager, { preset: 30, startPosition: 1, items: [{ productId: p.id, count: 1 }] }), "VALIDATION");
    await expectCode(labelsPdf(s.manager, { preset: 24, startPosition: 1, items: [{ productId: p.id, count: 2001 }] }), "VALIDATION");
    await expectCode(labelsPdf(s.staffA, { preset: 24, startPosition: 1, items: [{ productId: p.id, count: 1 }] }), "FORBIDDEN");
    await expectCode(labelsPdf(other.manager, { preset: 24, startPosition: 1, items: [{ productId: p.id, count: 1 }] }), "VALIDATION");
  });
});
