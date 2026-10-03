import { defineConfig } from "drizzle-kit";

/** SQL migrations are generated into ./drizzle from the schema files (`pnpm db:generate`). */
export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/server/db/schema.ts", "./src/server/db/stock-schema.ts"],
  out: "./drizzle",
});
