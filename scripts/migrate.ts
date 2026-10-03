/**
 * Applies the SQL migrations in ./drizzle to the database in DATABASE_URL (Supabase).
 * Usage: pnpm db:migrate     Use the direct or session-pooler connection string for this, not the transaction pooler.
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

async function main() {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (or DIRECT_URL) first.");
  if (url.startsWith("pglite:")) {
    console.log("Embedded database: migrations are applied automatically on start.");
    return;
  }
  const client = postgres(url, { max: 1, prepare: false });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
