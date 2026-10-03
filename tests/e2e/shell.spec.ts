import { test, expect, type Page } from "@playwright/test";

export const PASSWORD = "Demo@12345";

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(0);
}

const ROLES = [
  { email: "admin@demo.test", portal: "/admin" },
  { email: "owner@demo.test", portal: "/owner" },
  { email: "storeroom@demo.test", portal: "/storeroom" },
  { email: "storea@demo.test", portal: "/store" },
];

test("login page fits the screen", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const r of ROLES) {
  test(`${r.email} lands in ${r.portal} and cannot open other portals`, async ({ page }) => {
    await signIn(page, r.email);
    await page.waitForURL(`**${r.portal}`);
    await expectNoHorizontalOverflow(page);
    const other = r.portal === "/owner" ? "/store" : "/owner";
    await page.goto(other);
    await expect(page).toHaveURL(new RegExp(`${r.portal}$`));
  });
}

test("navigation matches the device size", async ({ page }, info) => {
  await signIn(page, "storeroom@demo.test");
  await page.waitForURL("**/storeroom");
  const width = page.viewportSize()!.width;
  const bottom = page.getByRole("navigation", { name: "Quick" });
  if (width < 768) {
    await expect(bottom).toBeVisible();
    await expect(page.getByRole("link", { name: "Scan a barcode" })).toBeVisible();
  } else {
    await expect(bottom).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Main" }).first()).toBeVisible();
  }
  info.annotations.push({ type: "width", description: String(width) });
});

test("wrong password shows a friendly error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@demo.test");
  await page.getByLabel("Password").fill("nope-nope");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
});
