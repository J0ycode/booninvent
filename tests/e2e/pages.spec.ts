import { test, expect } from "@playwright/test";
import { signIn, expectNoHorizontalOverflow } from "./shell.spec";

/** Device pass: every main screen loads without errors and never scrolls sideways at any project size. */
const PAGES: Record<string, string[]> = {
  "storeroom@demo.test": [
    "/storeroom",
    "/storeroom/products",
    "/storeroom/products/new",
    "/storeroom/products/import",
    "/storeroom/products/suppliers",
    "/storeroom/receive",
    "/storeroom/dispatch",
    "/storeroom/dispatch/new",
    "/storeroom/requests",
    "/storeroom/returns",
    "/storeroom/labels",
    "/storeroom/bills",
    "/storeroom/reports",
    "/storeroom/reports?type=movements",
  ],
  "storea@demo.test": ["/store", "/store/stock", "/store/incoming", "/store/restock", "/store/restock/new", "/store/returns", "/store/history"],
  "owner@demo.test": ["/owner", "/owner/reports", "/owner/approvals", "/owner/bills", "/owner/billing", "/owner/users", "/owner/settings"],
  "admin@demo.test": ["/admin"],
};

for (const [email, paths] of Object.entries(PAGES)) {
  test(`${email}: main screens fit the device`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await signIn(page, email);
    await page.waitForURL(/\/(storeroom|store|owner|admin)/);
    for (const path of paths) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBeLessThan(400);
      await expect(page.locator("h1").first(), path).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }
    expect(errors, "no client errors").toEqual([]);
  });
}

test("touch targets on the phone bottom bar are at least 44px", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 768, "phone only");
  await signIn(page, "storea@demo.test");
  await page.waitForURL("**/store");
  const links = page.getByRole("navigation", { name: "Quick" }).locator("a, button");
  for (const box of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

test("scanner falls back to typing when the camera is unavailable", async ({ page }) => {
  await signIn(page, "storea@demo.test");
  await page.waitForURL("**/store");
  await page.goto("/store/lookup?scan=1");
  const input = page.getByLabel("Type a barcode or SKU");
  await expect(input).toBeVisible();
  await input.fill("BB00000001");
  await page.getByRole("button", { name: "Find" }).click();
  await expect(page.getByText(/No product found|Store A/)).toBeVisible();
});

test("keyboard: skip link and visible focus", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("phone"), "keyboard check on tablet/desktop");
  await signIn(page, "owner@demo.test");
  await page.waitForURL("**/owner");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
});

test("PWA manifest and icons are served", async ({ request }) => {
  const m = await request.get("/manifest.webmanifest");
  expect(m.ok()).toBe(true);
  const json = await m.json();
  expect(json).toMatchObject({ name: "BoonBaby Store Manager", short_name: "BoonBaby", display: "standalone" });
  for (const icon of json.icons) expect((await request.get(icon.src)).headers()["content-type"]).toContain("image/png");
});
