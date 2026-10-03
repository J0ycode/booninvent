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
