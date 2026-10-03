# BoonBaby Store Manager

Stock management for retail baby shops (clothing and accessories). Each shop (tenant) has one **Store Room** (central stock) and its **Stores**. Stock flows **Supplier → Store Room → Store**, and every change is written to an append-only ledger. Selling happens in a separate billing module that calls this app's **Sales API**. There is **no payment integration**: bills are recorded and marked paid by hand.

Works on phone, tablet and desktop, and installs as an app (PWA).

| Portal | Who | Main screens |
|---|---|---|
| `/storeroom` | Store Room manager | Dashboard, Products (+ suppliers, CSV import), Receive Stock, Dispatch, Restock Requests, Returns and Damaged, Barcode Labels, Bills, Reports |
| `/store` | Store staff (one store) | Dashboard, My Stock, Incoming Dispatches, Request Restock, Return or Report Damaged, Stock History |
| `/owner` | Shop owner | Dashboard (all locations), Reports, Approvals, Bills, Billing, Users and Locations, Settings (company, API key) |
| `/admin` | Platform admin | Shops, platform bills, suspend/activate |

---

## 1. Run it locally

**Needs:** Node.js 20.9+ (22 or 24 recommended), pnpm 12 (`corepack enable`), and a Postgres database: a free **Supabase** project, or nothing at all for a quick local run (an embedded Postgres is built in). Docker is not needed.

```bash
pnpm install
cp .env.example .env.local      # then fill in DATABASE_URL and SESSION_SECRET
pnpm db:migrate                 # create the tables (Supabase only; the embedded database does this itself)
pnpm seed                       # demo shops + a login for every role
pnpm dev                        # http://localhost:3000
```

### Demo logins (after `pnpm seed`)
Password for all of them: **`Demo@12345`**

| Role | Email |
|---|---|
| Platform admin | admin@demo.test |
| Owner | owner@demo.test |
| Store Room manager | storeroom@demo.test |
| Store staff, Store A | storea@demo.test |
| Store staff, Store B | storeb@demo.test |
| Owner of a second shop (for isolation checks) | owner@other.test |

`pnpm seed` deletes and recreates only these two demo shops; other shops are not touched.

### Database options
- **Supabase (recommended):** create a project, then open **Connect** in the dashboard and copy the **Transaction pooler** connection string (port 6543) into `DATABASE_URL`, with your database password filled in. It starts with `postgresql://`. The `https://<ref>.supabase.co` address and the API keys are not used: the app talks to Postgres directly and keeps its own login.
  - `pnpm db:migrate` creates or updates the tables. For that command, set `DIRECT_URL` to the **Session pooler** string (port 5432).
  - Row-level security is switched on for every table with no policies, so Supabase's public REST API cannot read or write anything. The app connects as the database owner and is not affected.
- **Local, with nothing installed:** `DATABASE_URL=pglite://./.pglite` runs an embedded Postgres (PGlite) saved in the `.pglite` folder and applies the migrations by itself. One process at a time: stop `pnpm dev` before running `pnpm seed`.
- **Tests** use the embedded database in memory (`pglite://memory`); nothing to set up.

Changing the schema: edit `src/server/db/schema.ts` (or `stock-schema.ts`), run `pnpm db:generate` to write a new SQL file into `drizzle/`, review it, then `pnpm db:migrate`.

### Create the platform admin
The PLATFORM_ADMIN cannot be created in the UI:
```bash
pnpm create-platform-admin you@example.com 'a-strong-password' "Your Name"
```
Running it again for the same email resets the password.

---

## 2. Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / run it |
| `pnpm lint` | ESLint (includes the tenant-safety import rules) |
| `pnpm typecheck` | Route typegen + `tsc --noEmit` |
| `pnpm test` | Vitest: stock rules, tenant/store isolation, cost and bill visibility, API auth |
| `pnpm e2e` | Playwright at 360, 390 (iOS), 768, 1024, 1280 and 1920 widths. Run `pnpm exec playwright install chromium webkit` first; it starts its own database and app |
| `pnpm db:migrate` | Apply the SQL migrations in `drizzle/` to the database in `DIRECT_URL` / `DATABASE_URL` |
| `pnpm db:generate` | Write a new migration after changing the schema files |
| `pnpm seed` | Recreate the demo shops |
| `pnpm create-platform-admin` | Create or reset the platform admin |
| `pnpm format` | Prettier |

Husky runs `lint` and `typecheck` on every commit. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and e2e.

---

## 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string. Supabase: the Transaction pooler string (port 6543). Local: `pglite://./.pglite` |
| `DIRECT_URL` | for migrations | Supabase Session pooler string (port 5432), used only by `pnpm db:migrate`. Falls back to `DATABASE_URL` |
| `DATABASE_POOL_MAX` | optional | Connections per server instance (default 5) |
| `SESSION_SECRET` | yes | 32+ random characters used to sign session cookies. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Changing it signs everyone out |
| `APP_URL` | yes in production | Public URL, used in invite and password-reset links (e.g. `https://booninvent.vercel.app`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | for real emails | SMTP for invites and password resets. Without `SMTP_HOST`, emails are printed to the server log |
| `ERROR_WEBHOOK_URL` | optional | Every server error is also POSTed here as JSON (e.g. a Slack/Discord incoming webhook) |

Never commit `.env.local`. `.env.example` lists every variable.

---

## 4. Sales API (for the billing module)

The Owner creates the key in **Settings → Sales API key** (shown once, stored hashed; rotating stops the old key at once). The store ids are listed on the same page.

```http
POST /api/v1/sales
Authorization: Bearer bbk_…
Content-Type: application/json

{ "locationId": "<store id>", "externalRef": "BILL-2026-000123",
  "items": [ { "barcode": "BB00000022", "quantity": 2 } ] }
```

- **Idempotent on `externalRef`:** sending the same bill again changes nothing and returns the first result with `"duplicate": true` (HTTP 200). New sales return 201. Retry safely after timeouts.
- **All or nothing:** if any line fails, no stock changes.
- **Errors:** `{ "error": { "code", "message", "details" } }`

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION` | Bad or missing fields / not JSON |
| 401 | `UNAUTHENTICATED` | Missing, wrong or revoked key |
| 409 | `INSUFFICIENT_STOCK` | More than the store has (`details.available`) |
| 422 | `UNKNOWN_BARCODE` | Barcode not in this shop (`details.barcodes`) |
| 422 | `INVALID_LOCATION` | `locationId` is not one of this shop's stores |
| 423 | `TENANT_SUSPENDED` | Shop suspended by the platform admin |

```bash
curl -X POST "$APP_URL/api/v1/sales" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"locationId":"<store id>","externalRef":"BILL-1","items":[{"barcode":"BB00000022","quantity":1}]}'
```

**In-system billing module** (same codebase): call the same logic directly:
```ts
import { recordSale } from "@/server/stock/sales";
await recordSale(await getCtx(), { locationId, externalRef, items }); // OWNER, or STORE_STAFF of that store
```
More detail: [`docs/SALES_API.md`](docs/SALES_API.md).

---

## 5. Deploy (Vercel + Supabase)

1. **Supabase**
   - Create a project (the free tier is fine to start; Pro for real shops, which adds daily backups). Pick a region close to your shops, and keep the database password.
   - Dashboard -> **Connect**: copy the **Transaction pooler** string (for `DATABASE_URL`) and the **Session pooler** string (for `DIRECT_URL`).
   - From your machine, with both in `.env.local`: `pnpm db:migrate`.
2. **Vercel**
   - Add New Project → import `github.com/J0ycode/booninvent`. The framework is detected as Next.js; keep the default build settings (pnpm is read from `packageManager`).
   - Environment Variables (Production and Preview): `DATABASE_URL` (Transaction pooler string), `SESSION_SECRET`, `APP_URL`, plus SMTP and `ERROR_WEBHOOK_URL` if used.
   - Deploy. After the first deploy, set `APP_URL` to the final domain and redeploy.
3. **First run**
   - Create the platform admin from your machine against the production database: `DATABASE_URL=… pnpm create-platform-admin admin@yourdomain.com '…'`.
   - Optional demo data: `pnpm seed` with the production `DATABASE_URL` (creates only the demo shops). Skip this for a real launch.
   - Shops sign up at `/signup`.
4. Every push to `main` deploys automatically. Pull requests get preview URLs.

**Install note:** `pnpm-workspace.yaml` sets `minimumReleaseAgeExclude` for two transitive packages that were newer than pnpm's 1-day safety window at the time. Remove those lines once they are older.

### Backups
- Supabase **Pro** projects are backed up daily (7 days kept); point-in-time recovery is an add-on. See Database -> Backups.
- On the **free** tier there are no downloadable backups. Take a daily dump from a trusted machine with the Session pooler string:
  `pg_dump "$DIRECT_URL" --no-owner --format=custom --file=boonbaby-$(date +%F).dump` and keep copies off-site.
  Restore into an empty database: `pg_restore --no-owner --dbname="$DIRECT_URL" boonbaby-YYYY-MM-DD.dump`.
- The `stock_movements` ledger is append-only (a database trigger rejects updates and deletes): stock levels can always be checked against it (the sum of `quantity_delta` per product and location equals `stock_levels.quantity`).
- Free Supabase projects pause after about a week without activity. Open the dashboard and press Restore to wake one up.

### Error logging and monitoring
- Server errors are logged as one JSON line each (`src/instrumentation.ts`). See them in Vercel → Project → Logs (filter `level":"error`).
- Set `ERROR_WEBHOOK_URL` to also receive each error in Slack/Discord or a log service.
- Users see a friendly error page with **Try again**, and a code (digest) that matches the log line.
- Every state change is recorded in the `audit_logs` table (who, what, when).

---

## 6. How it is built

Next.js 16 (App Router, `src/proxy.ts`), TypeScript strict, Tailwind v4 + shadcn/ui (Base UI), TanStack Table, React Hook Form + Zod, Postgres (Supabase) + Drizzle ORM, jose cookie sessions + bcrypt, Nodemailer, bwip-js (Code 128), pdf-lib (dispatch notes, label sheets), @zxing/browser (camera scanning).

- **Tenant safety:** pages and routes never touch the database directly; everything goes through `src/server/data/*` (tenant taken from the session, never from input), enforced by ESLint and covered by isolation tests.
- **Stock correctness:** only `src/server/stock/*` changes quantities: Postgres transactions, never-negative conditional updates backed by a CHECK constraint, an append-only ledger enforced by a trigger, audit log, idempotency keys.
- Rules and conventions: [`CLAUDE.md`](CLAUDE.md). Design decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). Per-phase notes and test checklists: [`docs/PHASE-NOTES.md`](docs/PHASE-NOTES.md).
