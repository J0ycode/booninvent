@AGENTS.md

# BoonBaby Store Manager

Multi-tenant stock management for retail baby shops. Stock flows Supplier -> Store Room -> Store. Selling happens in a separate billing module, which calls our sales API. **No payment integration of any kind** (bills are recorded and marked paid by hand).

## Stack
Next.js 16 (App Router, `src/proxy.ts` instead of middleware, async `cookies()`/`params`) · TypeScript strict · Tailwind v4 · shadcn/ui (base-nova style = **Base UI**, use the `render` prop, not `asChild`) · TanStack Table v8 · React Hook Form + Zod v4 · Postgres on Supabase (database only: no Supabase Auth, no supabase-js) + Drizzle ORM + postgres-js · jose cookie sessions + bcryptjs · Nodemailer · bwip-js · pdf-lib · @zxing/browser · Vitest + PGlite (embedded Postgres) · Playwright.

## Commands
| | |
|---|---|
| `pnpm dev` | dev server (needs `.env.local` with DATABASE_URL + SESSION_SECRET; `pglite://./.pglite` works without Supabase) |
| `pnpm db:migrate` / `pnpm db:generate` | apply the SQL in `drizzle/` to Supabase / write a new migration after a schema change |
| `pnpm seed` | wipe and recreate the demo shops; every demo login uses password `Demo@12345` |
| `pnpm create-platform-admin <email> <password> [name]` | create the PLATFORM_ADMIN (not possible in the UI) |
| `pnpm lint` / `pnpm typecheck` | ESLint / tsc (Husky runs both on commit) |
| `pnpm test` | Vitest unit + isolation tests (in-memory PGlite, no setup needed) |
| `pnpm e2e` | Playwright at 360, 390 (iOS), 768, 1024, 1280 and 1920 widths (starts its own DB + app) |

Demo logins: admin@demo.test, owner@demo.test, storeroom@demo.test, storea@demo.test, storeb@demo.test, owner@other.test (second shop).

Working agreement: the user runs tests. Claude writes the tests, runs only lint and typecheck, and lists what to check in `docs/PHASE-NOTES.md`.

## Layout
- `src/config/brand.ts`: name and logo. `src/config/nav.ts`: navigation per portal.
- `src/server/db/schema.ts`: Drizzle tables. `db/stock-schema.ts` (stock_levels, stock_movements) is importable **only** from `src/server/stock`. `db/types.ts`: plain domain types (safe for UI). `db/index.ts`: `getDb()`, `withTransaction()`. `drizzle/*.sql`: migrations (`0001_guards.sql` holds the hand-written trigger and RLS).
- `src/server/data/*`: data-access layer. Every function takes `ctx` first and calls `guard(ctx, roles)`.
- `src/server/stock/*`: the only code that changes quantities.
- `src/server/mutation.ts`: `runMutation()` = suspended check + transaction + idempotency key + auditLog.
- `src/server/context.ts`: `getCtx()` (pages/actions), `ctxFromRequest()` (route handlers). `src/server/tenancy.ts`: the one place a tenant is resolved.
- `src/server/data/alerts.ts` + `src/app/api/cron/low-stock`: the scheduled daily low-stock email (no signed-in user; protected by `CRON_SECRET`, runs per shop with a read-only machine context).
- `src/app/{admin,owner,storeroom,store}`: portals. Each page is a server component and calls data functions; client parts call server actions in a sibling `actions.ts`.
- `src/components/app/*`: the shared component set (PageHeader, DataTable, StatusChip/Status, StatCard, EmptyState, ConfirmDialog, Field/NativeSelect/ActionBar, Section, Pagination, AppShell, ScannerSheet).

## Tenant-safety rules (never break these)
1. Every business document has `tenantId`; store-level data also has `locationId`.
2. Pages, route handlers, components, hooks and `src/lib` never import Drizzle, `@/server/db` or the table schemas (ESLint enforced; `@/server/db/types` is allowed). Go through `src/server/data/*` or `src/server/stock/*`.
3. `tenantId` always comes from `ctx` (`eq(table.tenantId, c.tenantId)` in every query, `tf(ctx)` for inserts), **never** from request input. STORE_STAFF are limited to `ctx.locationIds` (`assertLocationAccess`).
4. Cost prices live in `productCosts` and are read only for OWNER/STOREROOM_MANAGER. Never put cost in a response, page prop or CSV for STORE_STAFF.
5. Bills: supplier bills are OWNER/STOREROOM_MANAGER only; platform bills are created and marked only by PLATFORM_ADMIN, and the OWNER sees them read-only.
6. A SUSPENDED tenant can read but every write fails (`assertWritable`, inside `runMutation`).
7. Add an isolation test for every new data function (`tests/unit/*`).
8. Every new table gets `ENABLE ROW LEVEL SECURITY` in its migration (no policies): that keeps Supabase's public REST API out. The app connects as the owner.

## Stock rules
1. Quantities change only via `src/server/stock`, inside a transaction that also appends a `stock_movements` row. The ledger is append-only (a database trigger blocks update/delete).
2. Never negative: decrement with a conditional update (`quantity >= n`, plus a CHECK constraint); on failure throw `INSUFFICIENT_STOCK` with a plain-language message.
3. Movement types: RECEIPT, DISPATCH_OUT, DISPATCH_IN, SALE, RETURN_OUT, RETURN_IN, DAMAGE, SUPPLIER_RETURN, ADJUSTMENT.
4. Every state change writes auditLog. Every mutation accepts an idempotency key (`useAction` sends one; buttons are disabled while pending).
5. Sales are idempotent on `(tenantId, externalRef)`.
6. Inside a transaction, use the `tx` handle for every query and run them one after another. Never call a function that uses `getDb()` from inside a transaction (the embedded test database would wait forever), and never `Promise.all` on one `tx`.
7. A state change on a document (dispatch, request, return entry, bill) first loads the row with `.for("update")`, so two people cannot apply it twice.
8. A unique violation aborts the whole Postgres transaction: translate it to an `AppError` outside `runMutation`, not inside the callback.

## Conventions
- Ids are UUIDs (`objectId` in `src/lib/validation.ts` validates one; check ids from URLs with `assertId`/`isId` before querying). Dates used inside raw `sql` go through a column operator (`lt(col, date)`), never interpolated directly.
- Money is integer **paise** in the DB, shown with `money()`. Quantities are whole pieces (`num` class for tabular numbers).
- Server action pattern: `export async function xAction(key, ...args) { return toResult(async () => fn(await getCtx(), ...args, key)) }`; client uses `useAction`.
- Errors shown to users are `AppError` with plain-language messages.
- Mobile first: touch targets ≥44px (buttons default h-11), tables become cards on phone (`DataTable`), sticky `ActionBar` on phone, native `<select>`, `inputMode="numeric"` for quantities.
- Only build what the brief lists. Decisions go in `docs/DECISIONS.md`.
