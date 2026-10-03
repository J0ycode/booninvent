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

**Needs:** Node.js 20.9+ (22 or 24 recommended), pnpm 12 (`corepack enable`), and a MongoDB **replica set** (transactions are used for every stock change). Docker is not needed.

```bash
pnpm install
cp .env.example .env.local      # then fill in MONGODB_URI and SESSION_SECRET
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

### MongoDB options
- **MongoDB Atlas (recommended):** a free M0 cluster is a replica set. Use its connection string in `MONGODB_URI`, with a database name in the path, e.g. `…mongodb.net/boonbaby?retryWrites=true&w=majority`.
- **Local, without Docker:** install MongoDB Community, then start a single-node replica set:
  ```bash
  mongod --replSet rs0 --dbpath ./.mongo-data --port 27017      # create the folder first
  mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'   # once
  ```
  `MONGODB_URI=mongodb://127.0.0.1:27017/boonbaby?replicaSet=rs0`
- **Tests** need neither: they start an in-memory replica set (mongodb-memory-server).

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
| `pnpm seed` | Recreate the demo shops |
| `pnpm create-platform-admin` | Create or reset the platform admin |
| `pnpm format` | Prettier |

Husky runs `lint` and `typecheck` on every commit. GitHub Actions (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, build and e2e.

---

## 3. Environment variables

| Variable | Required | Description |
|---|---|---|
| `MONGODB_URI` | yes | MongoDB replica-set connection string (Atlas or local `?replicaSet=rs0`) |
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

## 5. Deploy (Vercel + MongoDB Atlas)

1. **Atlas**
   - Create a cluster (M0 free tier is fine to start; M10+ for real shops, which adds automatic backups).
   - Database Access: create a user with read/write on your database.
   - Network Access: add `0.0.0.0/0` (Vercel has no fixed IPs), or use Atlas's Vercel integration.
   - Copy the connection string and add the database name (`/boonbaby`).
2. **Vercel**
   - Add New Project → import `github.com/J0ycode/booninvent`. The framework is detected as Next.js; keep the default build settings (pnpm is read from `packageManager`).
   - Environment Variables (Production and Preview): `MONGODB_URI`, `SESSION_SECRET`, `APP_URL`, plus SMTP and `ERROR_WEBHOOK_URL` if used.
   - Deploy. After the first deploy, set `APP_URL` to the final domain and redeploy.
3. **First run**
   - Create the platform admin from your machine against the production database: `MONGODB_URI=… pnpm create-platform-admin admin@yourdomain.com '…'`.
   - Optional demo data: `pnpm seed` with the production `MONGODB_URI` (creates only the demo shops). Skip this for a real launch.
   - Shops sign up at `/signup`.
4. Every push to `main` deploys automatically. Pull requests get preview URLs.

**Install note:** `pnpm-workspace.yaml` sets `minimumReleaseAgeExclude` for two transitive packages that were newer than pnpm's 1-day safety window at the time. Remove those lines once they are older.

### Backups
- Atlas **M10+** clusters have continuous cloud backup with point-in-time restore. Turn it on (Cluster → Backup) and keep at least 7 days.
- On **M0/M2/M5** there are no automatic backups. Take a daily dump from a trusted machine:
  `mongodump --uri="$MONGODB_URI" --gzip --archive=boonbaby-$(date +%F).gz` and keep copies off-site.
  Restore: `mongorestore --uri="$MONGODB_URI" --gzip --archive=boonbaby-YYYY-MM-DD.gz --drop`.
- The `stockmovements` ledger is append-only: stock levels can always be checked against it (the sum of `quantityDelta` per product and location equals `stocklevels.quantity`).

### Error logging and monitoring
- Server errors are logged as one JSON line each (`src/instrumentation.ts`). See them in Vercel → Project → Logs (filter `level":"error`).
- Set `ERROR_WEBHOOK_URL` to also receive each error in Slack/Discord or a log service.
- Users see a friendly error page with **Try again**, and a code (digest) that matches the log line.
- Every state change is recorded in the `auditlogs` collection (who, what, when).

---

## 6. How it is built

Next.js 16 (App Router, `src/proxy.ts`), TypeScript strict, Tailwind v4 + shadcn/ui (Base UI), TanStack Table, React Hook Form + Zod, MongoDB + Mongoose 9, jose cookie sessions + bcrypt, Nodemailer, bwip-js (Code 128), pdf-lib (dispatch notes, label sheets), @zxing/browser (camera scanning).

- **Tenant safety:** pages and routes never touch the database directly; everything goes through `src/server/data/*` (tenant taken from the session, never from input), enforced by ESLint and covered by isolation tests.
- **Stock correctness:** only `src/server/stock/*` changes quantities: MongoDB transactions, never-negative conditional updates, append-only ledger, audit log, idempotency keys.
- Rules and conventions: [`CLAUDE.md`](CLAUDE.md). Design decisions: [`docs/DECISIONS.md`](docs/DECISIONS.md). Per-phase notes and test checklists: [`docs/PHASE-NOTES.md`](docs/PHASE-NOTES.md).
