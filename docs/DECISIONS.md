# Decisions

Each entry: decision, reason, alternative considered.

| # | Decision | Reason | Alternative |
|---|---|---|---|
| 1 | App at the root of `boon-inven`, its own git repo, remote `github.com/J0ycode/booninvent` | User's choice; clean start separate from the earlier Supabase attempt | Rebuild in the old folder |
| 2 | Sessions: signed JWT (jose, HS256) in an httpOnly cookie, and the user is re-checked in the DB on every request (`sessionVersion`) | Simple with email+password; instant revocation on deactivate or password reset | Auth.js credentials provider (heavier, and its JWT mode still needs custom revocation) |
| 3 | bcryptjs (cost 12) | Pure JS, no native build problems on Windows or Vercel | argon2 (native addon) |
| 4 | Login rate limit: 5 per email and 30 per IP per 15 minutes, stored in MongoDB with a TTL index | Works on serverless without Redis | In-memory limiter (not shared across instances) |
| 5 | Next.js 16 `proxy.ts` only routes (signed-out goes to /login, wrong portal goes to own portal); real checks run in the data layer | Proxy is a fast gate; authorization must not depend on it | Authorization in the proxy |
| 6 | Idempotency: an `idempotencyKeys` collection (unique scope+key, 24h TTL) written in the same transaction as the change; a repeat returns the stored result | Exactly-once even with double clicks and retries | Client-only button disabling |
| 7 | Document numbers and auto barcodes use per-tenant counters (`counters` collection) | Short, readable, unique per tenant | Random ids |
| 8 | Money stored as integer paise | No float rounding errors | Decimal128 |
| 9 | shadcn/ui "base-nova" (Base UI primitives), native `<select>` for dropdowns | Current shadcn default; native selects are the best phone experience and accessible | Radix-based select |
| 10 | TanStack Table v8 (pinned) | v9 changed the API substantially; v8 is stable and documented | v9 |
| 11 | The `DataTable` takes pre-rendered cells, renders a table on md+ and cards on phone | Works with server components and server-side pagination | A client table per page |
| 12 | Scripts run with `tsx --conditions=react-server` | Allows reuse of `server-only` modules in seed/admin scripts | Duplicating code in scripts |
| 13 | Store Room sidebar has 9 items | The brief lists 9 Store Room screens; that beats the "5-7 items" guideline | Grouping screens (adds hidden navigation) |
| 14 | Owner gets an "Approvals" page (and the dashboard links to it) | Owners may approve returns and write-offs; they need one place to do it | Approvals only inline on the dashboard |
| 15 | Phone Scan button opens `<portal>/lookup` (scan, then product card with stock) | The bottom nav needs a Scan target that works on every portal | Opening the scanner without a destination |
| 16 | Demo seed wipes and recreates two demo shops only (slugs `demo-baby-shop`, `other-baby-shop`) | Re-runnable without touching real shops | Wiping the whole database |
| 17 | Auto barcodes are `BB` + an 8-digit per-tenant counter (Code 128); auto SKUs are `SKU-00001` | Short, scannable, unique per tenant; an existing barcode can be typed or scanned instead | EAN-13 with check digit (needs a GS1 prefix the shop does not own) |
| 18 | Suppliers are managed at Products → Suppliers (Store Room) | Needed for receiving stock and bills, but not a top-level screen in the brief | A separate sidebar item |
| 19 | CSV import is all-or-nothing: preview first, import only when every row is valid; bulk insert in one transaction | No half-imported catalogues; fast for 5,000 rows | Import valid rows and skip bad ones |
| 20 | Product search: exact barcode, SKU prefix, or case-insensitive name contains, over an indexed lowercase name; 25 per page | Fast enough for 5,000 products per tenant without a search engine | Atlas Search |
| 21 | Native checkbox and select controls in forms | Reliable FormData and the native phone pickers | Base UI checkbox/select |
| 22 | Store staff see only active products and never see cost (the `costPrice` key is absent) | Cost-price rule; inactive products are hidden from stores | A null cost value |
| 23 | Workflow functions that change stock (receipts, dispatches, returns, sales) live in `src/server/stock/*` next to `applyMoves` | One module owns every quantity change, as the brief requires | Workflows in the data layer calling a stock API |
| 24 | A cost entered on a receipt line also becomes the product's current cost price | Keeps cost current without a separate edit | Cost history only on receipts |
| 25 | Duplicate product lines in one document are merged | One line per product keeps documents and the ledger clear | Allowing duplicates |
| 26 | Movements store `balanceAfter` | Stock history shows running balances without recomputing | Computing on read |
| 27 | Writing off a dispatch discrepancy records RETURN_IN then DAMAGE at the Store Room (net 0) | In-transit pieces are at no location; two ledger rows show exactly what happened, and every movement has a non-zero delta | A zero-delta movement |
| 28 | Store receipt: received + missing + damaged must equal sent per line, and a note is required when anything is flagged | Every piece is accounted for | Free entry |
| 29 | OWNER can also confirm a store receipt (besides the store's staff) | Covers a store with no staff signed in | Staff only |
| 30 | Dispatch note PDF is served from `/api/dispatches/:id/note` (A4, pdf-lib, Code 128 of the dispatch number) | Printable, shareable, works on phones | Browser print of the HTML page |
| 31 | A manual restock request is sent to the Store Room on submit (no saved draft step) | The brief says "enter quantities, submit"; fewer steps for staff | A savable draft |
| 32 | "Suggest restock" covers products the store has carried (a stock row exists), active, with reorderLevel > 0; a new suggestion replaces an unforwarded one | Otherwise every catalogue item would be suggested to every store | Suggesting the whole catalogue |
| 33 | "Edit" on a suggested line = approve with a new quantity | Matches Approve / Edit / Skip with no extra state | A separate EDITED state |
| 34 | Store Room manager/owner entries (damaged, return to supplier) apply immediately; store entries wait for approval | Managers are the approvers; the brief requires approval only for store returns and write-offs | Self-approval step |
| 35 | Stores can request several products in one return/damage submission (one entry per product) | Faster for staff; still per-product approval | One product per form |
| 36 | API key format `bbk_` + 40 random chars, SHA-256 hashed, one active key per shop, rotate = revoke old | Simple to use; secure at rest | Multiple named keys |
| 37 | Sales API: duplicate `externalRef` → 200 with `duplicate: true`; a failed sale does not reserve the `externalRef` | Safe retries; a corrected retry can still go through | 409 on duplicates |
| 38 | API-key calls run with an empty userId (movements and audit show userId null, audit action `sale.api`) | No fake user; audit still shows the source | A system user record |
| 39 | Label presets: 24 = 3×8 at 70×37 mm, 40 = 4×10 at 52.5×29.7 mm, 65 = 5×13 at 38.1×21.2 mm (common A4 sticker sheets) | Matches widely sold sheets; one config shared by preview and PDF | Custom sizes |
| 40 | Labels are generated server-side (`POST /api/labels`) and logged on every Print/Download; prices print as "Rs." | One source of truth; the built-in PDF fonts cannot draw "₹" | Client-side PDF |
| 41 | Print on phones opens the PDF in the system viewer; on desktop it prints from a hidden frame | Mobile browsers cannot print an iframe | Download only |
| 42 | Up to 2,000 labels per job | Keeps PDF generation fast on serverless | Unlimited |
| 43 | Dates for bills are calendar days in India time (stored as IST midnight); "Overdue" = UNPAID and due date before today (IST), computed on read | Matches how shops think about due dates; never stale | Storing an overdue flag |
| 44 | Bill totals (unpaid/overdue) ignore the status filter but respect the date and party filters | The cards always show what is outstanding in the chosen period | Totals of the visible page only |
| 45 | One CSV export route `/api/bills/export` serves supplier bills (managers), the owner's platform bills, and all platform bills (admin), by role | One place to secure | Separate routes |
| 46 | CSV cells starting with = + - @ get a leading ' | Prevents spreadsheet formula injection | Raw values |
| 47 | The STOREROOM_MANAGER sees supplier bills but not platform bills | The brief gives the platform Billing page to the OWNER only | Showing both |
| 48 | Low stock = quantity ≤ reorderLevel (reorderLevel > 0). The Store Room counts never-received products as 0; stores only count products they carry | The Store Room must see gaps in the catalogue; stores should not see the whole catalogue as low | The same rule everywhere |
| 49 | Reports show a 50-row on-screen preview and export the full CSV (up to 5,000 rows) from `/api/reports/:type` | "CSV export only" with a quick check before downloading | CSV without preview |
| 50 | Dashboard chart: one single-series horizontal bar chart (pieces by location) in CSS, direct-labelled, with a screen-reader table | One chart, as the brief asks; no chart library needed | A charting library |
| 51 | The bell's notices are computed in the portal layout and refresh on navigation after any change (revalidatePath) | Computed on load, no realtime, as the brief asks | Polling |
| 52 | No service worker: manifest + icons make the app installable; offline only shows the "You are offline" banner | The brief does not require offline support; avoids stale-cache bugs with live stock numbers | Workbox offline caching |
| 53 | PWA icons are generated from the text logo by `/icons/[name]` (next/og, static at build) | One brand source (`brand.ts`); swap for a real logo later | Hand-made PNG files |
| 54 | Security headers: nosniff, SAMEORIGIN framing, strict referrer, HSTS, `Permissions-Policy: camera=(self)` | Best-practice score; the camera stays available for scanning | No headers |
| 55 | Error logging: structured JSON lines via `onRequestError` (Vercel Logs) plus an optional webhook; no third-party SDK | Zero setup, no extra cost; easy to point at Slack/Discord/Logtail | Sentry SDK |
| 56 | Friendly `error.tsx` (Try again + digest), `not-found.tsx`, and skeleton `loading.tsx` per portal | Graceful handling of slow or failed connections | Default Next.js pages |
