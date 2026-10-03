import { describe, it, expect, vi, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeShop, expectCode, platformAdmin, suspended, type TestShop } from "../helpers";
import { getDb } from "@/server/db";
import { tenants } from "@/server/db/schema";
import { listAuditLogs } from "@/server/data/audit-log";
import { setLowStockEmail, getMyTenant } from "@/server/data/tenant";
import { sendLowStockDigests } from "@/server/data/alerts";
import { buildReport } from "@/server/data/reports";
import { createProduct } from "@/server/data/products";
import { saveSupplier } from "@/server/data/suppliers";
import { receiveStock } from "@/server/stock/receipts";
import { GET as cronGET } from "@/app/api/cron/low-stock/route";

const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/server/email", () => ({
  sendEmail: async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
  },
}));

beforeEach(() => {
  sent.length = 0;
});

const TOMORROW = () => new Date(Date.now() + 26 * 60 * 60 * 1000);

async function setup(s: TestShop) {
  const sup = await saveSupplier(s.manager, null, { name: "Sup" });
  const p = await createProduct(s.manager, { name: "Romper", category: "CLOTHING", sellingPrice: "100", costPrice: "55", reorderLevel: 5 });
  const q = await createProduct(s.manager, { name: "Bib", category: "ACCESSORY", sellingPrice: "50", reorderLevel: 2 });
  await receiveStock(s.manager, { supplierId: sup.id, invoiceNumber: "INV-9", lines: [{ productId: p.id, quantity: 20 }] });
  return { sup, p, q };
}

describe("activity log", () => {
  it("is owner-only and never shows entries of another shop", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await setup(s);
    await setup(other);
    await expectCode(listAuditLogs(s.manager), "FORBIDDEN");
    await expectCode(listAuditLogs(s.staffA), "FORBIDDEN");
    await expectCode(listAuditLogs(await platformAdmin()), "FORBIDDEN");
    await expectCode(listAuditLogs(null), "UNAUTHENTICATED");
    const mine = await listAuditLogs(s.owner);
    expect(mine.total).toBe(4); // supplier, 2 products, receipt
    expect(mine.rows.every((r) => r.userName === s.manager.name)).toBe(true);
    // Filtering by a user of another shop finds nothing.
    expect((await listAuditLogs(s.owner, { userId: other.manager.userId })).total).toBe(0);
  });

  it("filters by area, person, date and text", async () => {
    const s = await makeShop();
    await setup(s);
    await setLowStockEmail(s.owner, { enabled: true });
    expect((await listAuditLogs(s.owner, { area: "product" })).total).toBe(2);
    expect((await listAuditLogs(s.owner, { area: "not-an-area" })).total).toBe(5); // unknown area is ignored
    expect((await listAuditLogs(s.owner, { userId: s.owner.userId })).rows.map((r) => r.action)).toEqual(["tenant.low_stock_email"]);
    expect((await listAuditLogs(s.owner, { userId: "api" })).total).toBe(0);
    expect((await listAuditLogs(s.owner, { q: "inv-9" })).rows.map((r) => r.action)).toEqual(["stock.receive"]);
    expect((await listAuditLogs(s.owner, { q: "100%" })).total).toBe(0); // wildcards are literal
    expect((await listAuditLogs(s.owner, { from: "2000-01-01", to: "2000-01-02" })).total).toBe(0);
    expect((await listAuditLogs(s.owner, { pageSize: 2 })).rows).toHaveLength(2);
  });
});

describe("daily low-stock email", () => {
  it("only the owner can switch it; a suspended shop cannot change it", async () => {
    const s = await makeShop();
    expect((await getMyTenant(s.owner)).lowStockEmail).toBe(false);
    await expectCode(setLowStockEmail(s.manager, { enabled: true }), "FORBIDDEN");
    await expectCode(setLowStockEmail(s.owner, { enabled: "yes" }), "VALIDATION");
    await expectCode(setLowStockEmail(suspended(s.owner), { enabled: true }), "TENANT_SUSPENDED");
    await setLowStockEmail(s.owner, { enabled: true });
    expect((await getMyTenant(s.owner)).lowStockEmail).toBe(true);
  });

  it("emails owners of opted-in shops once a day, with the items of that shop only", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    await setup(s);
    await setup(other); // not opted in
    await setLowStockEmail(s.owner, { enabled: true });

    expect(await sendLowStockDigests()).toEqual({ shops: 1, emails: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(s.owner.email);
    expect(sent[0].text).toContain("Store Room: 1 item");
    expect(sent[0].text).toContain("Bib"); // never received, reorder level 2
    expect(sent[0].text).not.toContain("Romper"); // 20 in stock, not low
    expect(sent[0].text).not.toContain("55"); // no cost prices in the email

    // A second run on the same day sends nothing; the next day it sends again.
    expect(await sendLowStockDigests()).toEqual({ shops: 0, emails: 0, failed: 0 });
    expect((await sendLowStockDigests(TOMORROW())).emails).toBe(1);
  });

  it("skips suspended shops and sends nothing when nothing is low", async () => {
    const s = await makeShop();
    await setLowStockEmail(s.owner, { enabled: true });
    expect(await sendLowStockDigests()).toEqual({ shops: 1, emails: 0, failed: 0 }); // no products at all
    const t = await makeShop("Paused");
    await setup(t);
    await setLowStockEmail(t.owner, { enabled: true });
    await (await getDb()).update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, t.tenantId));
    expect((await sendLowStockDigests(TOMORROW())).emails).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("the scheduled route needs the secret", async () => {
    const call = (auth?: string) => cronGET(new Request("http://test/api/cron/low-stock", { headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("Bearer ")).status).toBe(401); // no secret configured: always refused
    process.env.CRON_SECRET = "cron-secret-for-tests-1234";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong-secret-for-tests-123")).status).toBe(401);
    const ok = await call("Bearer cron-secret-for-tests-1234");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ shops: 0, emails: 0, failed: 0 });
    delete process.env.CRON_SECRET;
  });
});

describe("report columns", () => {
  it("keeps only the chosen columns, in report order, and ignores unknown ones", async () => {
    const s = await makeShop();
    await setup(s);
    const full = await buildReport(s.owner, { type: "stock" });
    expect(full.columns).toEqual(full.allColumns);
    const picked = await buildReport(s.owner, { type: "stock", cols: "total,name,nope" });
    expect(picked.columns.map((c) => c.key)).toEqual(["name", "total"]);
    expect(picked.allColumns.length).toBe(full.allColumns.length);
    expect((await buildReport(s.owner, { type: "stock", cols: "nope" })).columns).toEqual(full.columns);
    // Choosing columns never widens access.
    await expectCode(buildReport(s.staffA, { type: "stock", cols: "cost" }), "FORBIDDEN");
  });
});
