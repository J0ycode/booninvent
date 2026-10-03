/**
 * Starts everything Playwright needs: an embedded Postgres database (PGlite, in a temp folder), demo seed data and the app.
 * Used by playwright.config.ts (webServer). Not for production.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = process.env.E2E_PORT ?? "3100";

async function main() {
  const dir = mkdtempSync(path.join(tmpdir(), "boonbaby-e2e-"));
  const env = {
    ...process.env,
    // The seed and the app open this folder one after the other (an embedded database allows one process at a time).
    DATABASE_URL: `pglite://${path.join(dir, "db").replace(/\\/g, "/")}`,
    SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-1234",
    APP_URL: `http://localhost:${PORT}`,
  };
  const seed = spawnSync("pnpm", ["exec", "tsx", "--conditions=react-server", "scripts/seed.ts"], { env, stdio: "inherit", shell: true });
  if (seed.status !== 0) throw new Error("Seeding failed");
  const cmd = process.env.CI ? ["exec", "next", "start", "-p", PORT] : ["exec", "next", "dev", "-p", PORT];
  if (process.env.CI) {
    const build = spawnSync("pnpm", ["exec", "next", "build"], { env, stdio: "inherit", shell: true });
    if (build.status !== 0) throw new Error("Build failed");
  }
  const app = spawn("pnpm", cmd, { env, stdio: "inherit", shell: true });
  const stop = () => {
    app.kill();
    rmSync(dir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  app.on("exit", stop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
