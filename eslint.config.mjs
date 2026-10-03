import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const stockModels = {
  group: ["@/server/models/stock", "**/models/stock"],
  message: "Only src/server/stock may touch stockLevels/stockMovements. Use the stock module.",
};
const dbAccess = [
  { group: ["mongoose", "mongodb"], message: "UI code must not access the database. Use src/server/data/*.", allowTypeImports: true },
  { group: ["@/server/models/*", "**/server/models/*", "@/server/db"], message: "Use the data-access layer (src/server/data/*) instead of models.", allowTypeImports: true },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  // Tenant safety: pages, route handlers, components and hooks never import models or mongoose.
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
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "coverage/**"]),
]);

export default eslintConfig;
