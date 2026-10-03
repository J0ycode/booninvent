import { afterAll, beforeAll, beforeEach, inject, vi } from "vitest";
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "@/server/db";

process.env.MONGODB_URI = inject("mongoUri");
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-123";

// next/headers and next/cache are not available outside a request in tests.
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, updateTag: () => {} }));

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI);
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).createIndexes()));
});

beforeEach(async () => {
  // Fresh data per test. Raw driver deletes bypass the ledger's append-only guard (tests only).
  const db = mongoose.connection.db!;
  for (const c of await db.collections()) await c.deleteMany({});
});

afterAll(async () => {
  await disconnectDb();
});
