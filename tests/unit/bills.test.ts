import { describe, it, expect } from "vitest";
import { makeShop, expectCode, platformAdmin, suspended } from "../helpers";
import {
  saveSupplierBill,
  listSupplierBills,
  getSupplierBill,
  deleteSupplierBill,
  markSupplierBillPaid,
  markSupplierBillUnpaid,
  listMyPlatformBills,
  adminSavePlatformBill,
  adminListPlatformBills,
  adminMarkPlatformBillPaid,
  adminMarkPlatformBillUnpaid,
  adminDeletePlatformBill,
  adminListShops,
  adminSetShopStatus,
} from "@/server/data/bills";
import { saveSupplier } from "@/server/data/suppliers";
import { createProduct } from "@/server/data/products";
import { isOverdue } from "@/lib/dates";
import { isoDay } from "@/lib/format";
import { GET as exportGET } from "@/app/api/bills/export/route";
import { signSession, SESSION_COOKIE } from "@/server/auth/session";

const day = (offsetDays: number) => isoDay(new Date(Date.now() + offsetDays * 864e5));

describe("supplier bills", () => {
  it("OWNER and STOREROOM_MANAGER can manage them; STORE_STAFF cannot see any", async () => {
    const s = await makeShop();
    const sup = await saveSupplier(s.manager, null, { name: "Little Threads" });
    const b = await saveSupplierBill(s.manager, null, { supplierId: sup.id, billNumber: "LT-1", billDate: day(-10), dueDate: day(5), amount: "1234.50" });
    expect(b.amount).toBe(123450);
    expect((await listSupplierBills(s.owner)).total).toBe(1);
    await expectCode(listSupplierBills(s.staffA), "FORBIDDEN");
    await expectCode(getSupplierBill(s.staffA, b.id), "FORBIDDEN");
    await expectCode(saveSupplierBill(s.staffA, null, { supplierId: sup.id, billNumber: "X", billDate: day(0), dueDate: day(1), amount: "1" }), "FORBIDDEN");
    await expectCode(markSupplierBillPaid(s.staffA, b.id, {}), "FORBIDDEN");
  });

  it("overdue is computed; totals show unpaid and overdue", async () => {
    const s = await makeShop();
    const sup = await saveSupplier(s.manager, null, { name: "Sup" });
    await saveSupplierBill(s.manager, null, { supplierId: sup.id, billNumber: "A", billDate: day(-40), dueDate: day(-10), amount: "100" });
    await saveSupplierBill(s.manager, null, { supplierId: sup.id, billNumber: "B", billDate: day(-1), dueDate: day(20), amount: "50" });
    const all = await listSupplierBills(s.owner);
    expect(all.rows.find((r) => r.billNumber === "A")!.overdue).toBe(true);
    expect(all.rows.find((r) => r.billNumber === "B")!.overdue).toBe(false);
    expect(all.totals).toEqual({ unpaidCount: 2, unpaidAmount: 15000, overdueCount: 1, overdueAmount: 10000 });
    expect((await listSupplierBills(s.owner, { status: "overdue" })).rows.map((r) => r.billNumber)).toEqual(["A"]);
    expect(isOverdue({ status: "PAID", dueDate: new Date(0) })).toBe(false);
  });

  it("mark paid records date/note; paid bills are locked until marked unpaid", async () => {
    const s = await makeShop();
    const sup = await saveSupplier(s.manager, null, { name: "Sup" });
    const b = await saveSupplierBill(s.manager, null, { supplierId: sup.id, billNumber: "A", billDate: day(-5), dueDate: day(-1), amount: "100" });
    const paid = await markSupplierBillPaid(s.owner, b.id, { note: "Paid by UPI" });
    expect(paid).toMatchObject({ status: "PAID", overdue: false, paidNote: "Paid by UPI" });
    expect(paid.paidDate).not.toBeNull();
    await expectCode(saveSupplierBill(s.manager, b.id, { supplierId: sup.id, billNumber: "A2", billDate: day(-5), dueDate: day(1), amount: "100" }), "INVALID_STATE");
    await expectCode(deleteSupplierBill(s.manager, b.id), "INVALID_STATE");
    await expectCode(markSupplierBillPaid(s.owner, b.id, {}), "INVALID_STATE");
    const unpaid = await markSupplierBillUnpaid(s.manager, b.id);
    expect(unpaid.status).toBe("UNPAID");
    expect(unpaid.paidDate).toBeNull();
    await deleteSupplierBill(s.manager, b.id);
    expect((await listSupplierBills(s.owner)).total).toBe(0);
  });

  it("validates dates, supplier and receipt of the same tenant", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const supA = await saveSupplier(a.manager, null, { name: "Sup" });
    const supB = await saveSupplier(b.manager, null, { name: "Sup" });
    await expectCode(saveSupplierBill(a.manager, null, { supplierId: supA.id, billNumber: "X", billDate: day(0), dueDate: day(-1), amount: "1" }), "VALIDATION");
    await expectCode(saveSupplierBill(a.manager, null, { supplierId: supB.id, billNumber: "X", billDate: day(0), dueDate: day(1), amount: "1" }), "VALIDATION");
  });

  it("is isolated per tenant", async () => {
    const a = await makeShop("A");
    const b = await makeShop("B");
    const sup = await saveSupplier(a.manager, null, { name: "Sup" });
    const bill = await saveSupplierBill(a.manager, null, { supplierId: sup.id, billNumber: "A", billDate: day(0), dueDate: day(1), amount: "1" });
    expect((await listSupplierBills(b.owner)).total).toBe(0);
    await expectCode(getSupplierBill(b.owner, bill.id), "NOT_FOUND");
    await expectCode(markSupplierBillPaid(b.owner, bill.id, {}), "NOT_FOUND");
    await expectCode(deleteSupplierBill(b.manager, bill.id), "NOT_FOUND");
  });

  it("suspended shops cannot change bills", async () => {
    const s = await makeShop();
    const sup = await saveSupplier(s.manager, null, { name: "Sup" });
    await expectCode(saveSupplierBill(suspended(s.manager), null, { supplierId: sup.id, billNumber: "A", billDate: day(0), dueDate: day(1), amount: "1" }), "TENANT_SUSPENDED");
  });
});

describe("platform bills", () => {
  it("only PLATFORM_ADMIN creates and marks them; the OWNER reads them; manager and staff cannot", async () => {
    const s = await makeShop();
    const other = await makeShop("Other");
    const admin = await platformAdmin();
    const b = await adminSavePlatformBill(admin, s.tenantId, null, { billNumber: "P-1", description: "October", amount: "999", issueDate: day(-3), dueDate: day(10) });
    await adminSavePlatformBill(admin, other.tenantId, null, { billNumber: "P-2", description: "October", amount: "999", issueDate: day(-3), dueDate: day(10) });

    expect((await listMyPlatformBills(s.owner)).rows.map((r) => r.billNumber)).toEqual(["P-1"]); // never another shop's
    await expectCode(listMyPlatformBills(s.manager), "FORBIDDEN");
    await expectCode(listMyPlatformBills(s.staffA), "FORBIDDEN");
    // Platform bills never show in the supplier bills list.
    expect((await listSupplierBills(s.owner)).total).toBe(0);

    for (const c of [s.owner, s.manager, s.staffA]) {
      await expectCode(adminSavePlatformBill(c, s.tenantId, null, { billNumber: "X", description: "xx", amount: "1", issueDate: day(0), dueDate: day(1) }), "FORBIDDEN");
      await expectCode(adminMarkPlatformBillPaid(c, b.id, {}), "FORBIDDEN");
      await expectCode(adminListShops(c), "FORBIDDEN");
    }
    // The owner cannot mark a platform bill through the supplier functions either.
    await expectCode(markSupplierBillPaid(s.owner, b.id, {}), "NOT_FOUND");

    const paid = await adminMarkPlatformBillPaid(admin, b.id, { note: "Cash" });
    expect(paid.status).toBe("PAID");
    await expectCode(adminDeletePlatformBill(admin, b.id), "INVALID_STATE");
    await adminMarkPlatformBillUnpaid(admin, b.id);
    await adminDeletePlatformBill(admin, b.id);
    expect((await adminListPlatformBills(admin, { tenantId: s.tenantId })).total).toBe(0);
  });

  it("admin shop list shows owner email, status and unpaid totals; suspending blocks writes but not reads", async () => {
    const s = await makeShop();
    const admin = await platformAdmin();
    await adminSavePlatformBill(admin, s.tenantId, null, { billNumber: "P-1", description: "Late", amount: "500", issueDate: day(-30), dueDate: day(-5) });
    const row = (await adminListShops(admin)).find((r) => r.id === s.tenantId)!;
    expect(row).toMatchObject({ status: "ACTIVE", unpaidCount: 1, unpaidAmount: 50000, overdueCount: 1 });
    expect(row.ownerEmail).toBe(s.owner.email);
    await adminSetShopStatus(admin, s.tenantId, "SUSPENDED");
    expect((await adminListShops(admin)).find((r) => r.id === s.tenantId)!.status).toBe("SUSPENDED");
    // Reads still work for the suspended shop; writes are refused (ctx reflects the stored status at request time).
    expect((await listMyPlatformBills(suspended(s.owner))).total).toBe(1);
    await expectCode(createProduct(suspended(s.manager), { name: "X", category: "CLOTHING", sellingPrice: "1" }), "TENANT_SUSPENDED");
  });
});

describe("GET /api/bills/export", () => {
  const call = async (sub: string, role: string, qs: string) => {
    const token = await signSession({ sub, role: role as never, sv: 1 });
    return exportGET(new Request(`http://test/api/bills/export?${qs}`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }));
  };

  it("supplier CSV for managers only; staff get 403", async () => {
    const s = await makeShop();
    const sup = await saveSupplier(s.manager, null, { name: "=cmd" });
    await saveSupplierBill(s.manager, null, { supplierId: sup.id, billNumber: "LT-1", billDate: day(0), dueDate: day(1), amount: "10" });
    const ok = await call(s.manager.userId, "STOREROOM_MANAGER", "kind=supplier");
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain("LT-1");
    expect(text).toContain("'=cmd"); // spreadsheet formula injection neutralised
    expect((await call(s.staffA.userId, "STORE_STAFF", "kind=supplier")).status).toBe(403);
    expect((await call(s.manager.userId, "STOREROOM_MANAGER", "kind=platform")).status).toBe(403);
  });
});
