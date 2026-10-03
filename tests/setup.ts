import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { getDb, disconnectDb } from "@/server/db";
import * as schema from "@/server/db/schema";
import * as stockSchema from "@/server/db/stock-schema";

// Embedded in-memory Postgres (PGlite): no setup needed, the migrations in ./drizzle are applied on start.
process.env.DATABASE_URL = "pglite://memory";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";

// next/headers and next/cache are not available outside a request in tests.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} }));

const TABLES = ([...Object.values(schema), ...Object.values(stockSchema)] as unknown[])
  .filter((t): t is PgTable => is(t, PgTable))
  .map((t) => `"${getTableName(t)}"`)
  .join(", ");

beforeAll(async () => {
  await getDb();
});

beforeEach(async () => {
  // Fresh data per test. TRUNCATE is not stopped by the ledger's append-only trigger (tests only).
  const db = await getDb();
  await db.execute(sql.raw(`truncate table ${TABLES} restart identity cascade`));
});

afterAll(async () => {
  await disconnectDb();
});
