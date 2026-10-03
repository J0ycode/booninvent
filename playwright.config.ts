import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3100";

/** Every spec runs at phone, tablet (both orientations) and desktop sizes. */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "phone-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 800 } } },
    { name: "phone-ios", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { browserName: "chromium", viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "tablet-1024", use: { browserName: "chromium", viewport: { width: 1024, height: 768 }, hasTouch: true } },
    { name: "desktop-1280", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
    { name: "desktop-1920", use: { browserName: "chromium", viewport: { width: 1920, height: 1080 } } },
  ],
  webServer: {
    command: "pnpm exec tsx scripts/e2e-server.ts",
    url: `http://localhost:${PORT}/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
  },
});
