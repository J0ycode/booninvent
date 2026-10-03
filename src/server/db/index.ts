import "server-only";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/*
 * One Postgres connection per process (dev hot reload and serverless safe).
 *
 * DATABASE_URL:
 *   postgres://...        Supabase (use the "Transaction pooler" string on Vercel)
 *   pglite://memory       embedded in-memory Postgres (tests)
 *   pglite://./.pglite    embedded Postgres saved in a local folder (local development without Supabase)
 * The embedded database applies the SQL migrations in ./drizzle automatically; for Supabase run `pnpm db:migrate`.
 */

export type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;
/** A transaction handle. Same query API as Db. */
export type Tx = Db;

interface Cache {
  db: Db | null;
  promise: Promise<Db> | null;
  close: (() => Promise<void>) | null;
}
const g = globalThis as unknown as { __boonDb?: Cache };
const cache: Cache = (g.__boonDb ??= { db: null, promise: null, close: null });

export const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Missing environment variable DATABASE_URL. See .env.example.");
  return url;
}

async function open(url: string): Promise<Db> {
  if (url.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const target = url.replace(/^pglite:\/\//, "");
    const client = new PGlite(target === "memory" || target === "" ? undefined : target);
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    cache.close = () => client.close();
    return db as unknown as Db;
  }
  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  // prepare:false is required by Supabase's transaction pooler (pgbouncer).
  const client = postgres(url, { prepare: false, max: Number(process.env.DATABASE_POOL_MAX ?? 5), idle_timeout: 20, connect_timeout: 15 });
  cache.close = () => client.end({ timeout: 5 });
  return drizzle(client) as unknown as Db;
}

export async function getDb(url?: string): Promise<Db> {
  if (cache.db) return cache.db;
  cache.promise ??= open(url ?? databaseUrl());
  try {
    cache.db = await cache.promise;
  } catch (e) {
    cache.promise = null;
    throw e;
  }
  return cache.db;
}

/** Kept for call sites that only need "make sure the database is reachable". */
export const connectDb = getDb;

export async function disconnectDb() {
  const close = cache.close;
  cache.db = null;
  cache.promise = null;
  cache.close = null;
  await close?.();
}

/** Run fn inside one Postgres transaction. Any thrown error rolls everything back. */
export async function withTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction((tx) => fn(tx as unknown as Tx));
}
