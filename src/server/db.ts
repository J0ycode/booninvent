import "server-only";
import mongoose from "mongoose";
import { env } from "./env";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };
const g = globalThis as unknown as { __mongoose?: Cache };
const cache: Cache = (g.__mongoose ??= { conn: null, promise: null });

/** Connect once per process (dev hot reload and serverless safe). */
export async function connectDb(uri?: string): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  cache.promise ??= mongoose.connect(uri ?? env.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10_000,
  });
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  return cache.conn;
}

export async function disconnectDb() {
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}

/** Run fn inside a MongoDB transaction (retries transient errors). */
export async function withTransaction<T>(fn: (session: mongoose.mongo.ClientSession) => Promise<T>): Promise<T> {
  const conn = await connectDb();
  return conn.connection.transaction(fn);
}
