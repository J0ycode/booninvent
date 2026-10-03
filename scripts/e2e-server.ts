/**
 * Starts everything Playwright needs: an in-memory MongoDB replica set, demo seed data and the app.
 * Used by playwright.config.ts (webServer). Not for production.
 */
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn, spawnSync } from "node:child_process";

const PORT = process.env.E2E_PORT ?? "3100";

async function main() {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const env = {
    ...process.env,
    MONGODB_URI: rs.getUri("boonbaby_e2e"),
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
  const stop = async () => {
    app.kill();
    await rs.stop();
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
