import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const stockModels = {
  group: ["@/server/db/stock-schema", "**/db/stock-schema"],
  message: "Only src/server/stock may touch stock_levels/stock_movements. Use the stock module.",
};
const dbAccess = [
  { group: ["drizzle-orm", "drizzle-orm/*", "postgres", "@electric-sql/pglite"], message: "UI code must not access the database. Use src/server/data/*.", allowTypeImports: true },
  // "@/server/db/types" (plain types) stays importable.
  { group: ["@/server/db", "@/server/db/index", "@/server/db/schema", "@/server/db/stock-schema", "@/server/db/helpers", "**/server/db/schema"], message: "Use the data-access layer (src/server/data/*) instead of the database tables.", allowTypeImports: true },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Tenant safety: pages, route handlers, components and hooks never import the database tables or the ORM.
  {
    files: ["src/app/**", "src/components/**", "src/hooks/**", "src/lib/**", "src/proxy.ts"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [...dbAccess, stockModels] }],
    },
  },
  // Stock rule 1: quantities change only inside src/server/stock.
  {
    files: ["src/server/**"],
    ignores: ["src/server/stock/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [stockModels] }],
    },
  },
  globalIgnores([".next/**", "drizzle/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "coverage/**"]),
]);

export default eslintConfig;
