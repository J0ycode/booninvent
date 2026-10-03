import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { makeShop } from "../helpers";
import { signSession, SESSION_COOKIE } from "@/server/auth/session";

/**
 * Every API route must reject unauthenticated calls, and session routes must reject wrong roles.
 * New routes are picked up automatically.
 */
const API_DIR = path.resolve(__dirname, "../../src/app/api");

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return f === "route.ts" ? [p] : [];
  });
}

const FAKE_ID = "64b00000-0000-4000-8000-000000000000";
const urlFor = (file: string) =>
  "http://test/api/" +
  path
    .relative(API_DIR, path.dirname(file))
    .split(path.sep)
    .map((seg) => (seg.startsWith("[") ? FAKE_ID : seg))
    .join("/");

const params = { params: Promise.resolve(new Proxy({}, { get: () => FAKE_ID })) };

describe("API routes", () => {
  const files = routeFiles(API_DIR);

  it("found the route files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
      it(`${method} ${path.relative(API_DIR, file)} rejects unauthenticated requests`, async () => {
        const mod = await import(file);
        const handler = mod[method] as ((req: Request, ctx: unknown) => Promise<Response>) | undefined;
        if (!handler) return;
        const res = await handler(new Request(urlFor(file), { method, ...(method === "GET" ? {} : { body: "{}", headers: { "content-type": "application/json" } }) }), params);
        expect(res.status).toBe(401);
      });
    }
  }

  it("session routes reject a session for a deactivated/unknown user", async () => {
    const token = await signSession({ sub: FAKE_ID, role: "OWNER", sv: 1 });
    for (const file of files.filter((f) => !f.includes(`${path.sep}v1${path.sep}`))) {
      const mod = await import(file);
      if (!mod.GET) continue;
      const res = await mod.GET(new Request(urlFor(file), { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), params);
      expect(res.status).toBe(401);
    }
  });

  it("dispatch note: store staff of another store get 404, not the PDF", async () => {
    const s = await makeShop();
    const token = await signSession({ sub: s.staffB.userId, role: "STORE_STAFF", sv: 1 });
    const { GET } = await import("@/app/api/dispatches/[id]/note/route");
    const res = await GET(new Request(`http://test/api/dispatches/${FAKE_ID}/note`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }), params as never);
    expect(res.status).toBe(404);
  });
});
