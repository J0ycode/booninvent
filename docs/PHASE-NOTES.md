# Phase notes

A summary and a test checklist for each phase. The user runs the tests (`pnpm test`, `pnpm e2e`); Claude ran lint and typecheck.

---

## Phase 1: Foundation (repo, auth, tenancy, shell)

**Built**
- Next.js 16 + TS strict + Tailwind v4 + shadcn (Base UI), ESLint (with tenant-safety import rules), Prettier, Husky pre-commit (lint + typecheck), Vitest (in-memory replica set), Playwright (6 device sizes), GitHub Actions CI.
- MongoDB connection with a transaction helper; every model and its indexes (later phases reuse them).
- Data-access layer with `guard(ctx, roles)`, `tf(ctx)` tenant filter, STORE_STAFF location check, and `runMutation` (transaction + idempotency key + auditLog + suspended-shop block).
- Auth: email+password (bcrypt), JWT cookie, re-validated on every request; login rate limiting; password reset and invite emails (printed to the console in dev); signup creates shop + Store Room + first Store + Owner.
- Portals `/admin`, `/owner`, `/storeroom`, `/store` with role routing in `src/proxy.ts`; responsive shell: desktop sidebar, tablet icon rail, phone bottom nav (Home, Stock, Scan, Requests, More), safe-area insets, light/dark/system theme, offline banner, skip link.
- Owner: Users and Locations (invite, edit role/store, deactivate, resend invite, add/rename store) and Settings (company details).
- Scripts: `pnpm seed` (demo logins for every role + a second shop) and `pnpm create-platform-admin`.

**Run**
```
pnpm test        # tests/unit/auth.test.ts, tests/unit/tenancy.test.ts
pnpm e2e         # first time: pnpm exec playwright install chromium webkit
```

**Check by hand** (`pnpm dev`, then sign in with the password `Demo@12345`)
- [ ] Each demo login lands in its own portal; typing another portal's URL bounces back.
- [ ] Wrong password shows "Email or password is incorrect". After 5 failures you are told to wait.
- [ ] Sign up a new shop and land on /owner. Users and Locations shows Store Room + your store.
- [ ] Invite a Store staff: the console shows an email with a link; open it, set a password, and land on /store.
- [ ] Forgot password: the console shows a link; resetting signs you in.
- [ ] At 360px: bottom nav with a raised Scan button and More opening a sheet. At 768/1024: icon rail. At 1280+: full sidebar. No sideways scrolling.
- [ ] The theme button cycles system, light, dark.

---

## Phase 2: Products, suppliers, barcodes, CSV import, scan/search

**Built**
- Data: `suppliers`, `products` (search, filters, server pagination), `productCosts` (separate collection, managers only), scan lookup by barcode/SKU, CSV import with validation preview (all-or-nothing, bulk insert).
- Barcodes: auto Code 128 (`BB00000001`) or an entered/scanned code; unique per tenant; rendered as SVG with bwip-js.
- Screens (Store Room): Products list (search, category/supplier/status filters, Store Room qty, low-stock highlight), Add/Edit product (with barcode and stock per location), Suppliers, Import CSV (template download, preview, import).
- Shared: `ScanSearch` (debounced server search; USB scanner works by typing + Enter; camera button on touch devices), `ScannerSheet` (full-screen camera via ZXing, item card + quantity stepper, typing fallback when permission is denied), `<portal>/lookup` behind the phone Scan button.
- Seed: 2 suppliers + 63 products.

**Run**: `pnpm test` (adds `tests/unit/products.test.ts`)

**Check by hand** (storeroom@demo.test)
- [ ] Products: type "romp" and the list filters; paging works; filters combine.
- [ ] Add a product with the barcode empty and get `BB…`; the edit page shows the barcode image.
- [ ] Add a product with an existing barcode: "Another product already uses this barcode".
- [ ] Import: download the template, import it, see the preview, then import. Break a row (e.g. category "Shoes") and import is blocked with row errors.
- [ ] Phone: tap Scan in the bottom bar and allow the camera; scanning a printed barcode shows the item card with stock. Deny the camera and you can type the code.
- [ ] storea@demo.test: Scan shows only Store A stock and no cost anywhere.

---

## Phase 3: Stock module + Receive Stock

**Built**
- `src/server/stock/core.ts` `applyMoves()`: the only quantity writer. Products and locations must belong to the tenant; decrements are atomic conditional updates (`quantity >= n`) that fail with a plain message ("Not enough stock: Romper has 3 at Store Room, but 5 are needed."); every change appends a movement with `balanceAfter` in the same transaction. The ledger model blocks updates and deletes.
- `receiveStock()` (OWNER, STOREROOM_MANAGER): supplier + invoice + lines (qty, optional cost) → RCV-00001, RECEIPT movements, audit, idempotent.
- Stock reads (`src/server/stock/read.ts`): levels, totals, movements; STORE_STAFF restricted to their store.
- Screens: Receive Stock (supplier, invoice, a lines editor with search, camera scan, USB scan + Enter, quantity and cost) with recent receipts; receipt detail with a "Print labels" link (labels come in Phase 7).
- Shared `LinesEditor`, reused by dispatch and restock.
- Seed: two receipts, so the Store Room has stock (two accessories left at 0).

**Run**: `pnpm test` (adds `tests/unit/stock.test.ts`: negative stock blocked + rollback, concurrency cannot oversell, ledger sums equal levels, append-only, idempotency, roles, tenant/store scoping).

**Check by hand** (storeroom@demo.test)
- [ ] Receive Stock: pick a supplier, type an invoice no., search "bib", add it, set qty 5 → saved as RCV-00003 and the product's Store Room qty goes up by 5.
- [ ] Type a barcode from the products list into the add box and press Enter: the line is added (like a USB scanner).
- [ ] Double-tap "Receive stock" on a slow connection: only one receipt is created.
- [ ] Phone: the camera button in the add box opens the scanner with a quantity stepper and "Add".

---

## Phase 4: Dispatch, store receipt, discrepancies

**Built**
- `src/server/stock/dispatches.ts`: draft create/edit/discard (no stock), send (DRAFT → DISPATCHED, DISPATCH_OUT from the Store Room), store receipt (received/missing/damaged per line + note; DISPATCH_IN of good pieces; RECEIVED or RECEIVED_WITH_ISSUES), discrepancy resolution by the Store Room (Return to stock = RETURN_IN; Write off = RETURN_IN + DAMAGE) → RESOLVED when all lines are done.
- STORE_STAFF see only dispatches to their store and never drafts.
- Screens: Store Room Dispatch list (status/store filters), New dispatch (lines editor with Store Room availability), draft edit/send/discard, dispatch detail with per-line resolve buttons, Dispatch note PDF. Store: Incoming Dispatches (to confirm + history) and a receive form (defaults to everything received; flag missing/damaged with a note).
- Seed: received, received-with-issues, in-transit and draft dispatches.

**Run**: `pnpm test` (adds `tests/unit/dispatch.test.ts`)

**Check by hand**
- [ ] storeroom@demo.test → Dispatch → New → Store B, add 2 products → Save draft → Send. Store Room qty drops.
- [ ] Try to send more than available: the line turns red, and the server refuses with a plain message.
- [ ] storeb@demo.test → Incoming → open the new dispatch → set 1 damaged with a note → Confirm with issues.
- [ ] storeroom → Dispatch → filter "Received with issues" → Return to stock / Write off; it becomes Resolved.
- [ ] Open "Dispatch note (PDF)" on a phone and a desktop.
- [ ] storea@demo.test cannot open a Store B dispatch URL (404).

---

## Phase 5: Restock requests

**Built**
- `src/server/data/restock.ts`: manual request (straight to SENT), Suggest restock (low-stock products, qty = max(1, reorder×2 − current), WAITING_STAFF_APPROVAL, private to the store), Approve / Edit / Skip per line, Forward to Store Room, discard suggestion; Store Room approve (creates a pre-filled draft dispatch in one click, linked back) and reject (with reason). Sending that dispatch marks the request DISPATCHED.
- Screens: Store → Request Restock (list, New request with the lines editor, Suggest restock, review screen); Store Room → Restock Requests (waiting/approved/dispatched/rejected filter, detail with store vs Store Room stock, Approve → jumps to the draft dispatch, Reject with reason).
- Seed: one manual request from Store B waiting for the Store Room.

**Run**: `pnpm test` (adds `tests/unit/restock.test.ts`)

**Check by hand**
- [ ] storeb@demo.test → Request Restock → New request → add 2 products → Send.
- [ ] storeroom@demo.test → Restock Requests → open it → "Approve and create dispatch" lands on the draft dispatch → Send. The store sees the request as Dispatched.
- [ ] Suggest restock (store staff): with nothing low you see "Nothing is at or below its reorder level". After Phase 6 sales, Store A has low items; review them with Approve/Edit/Skip, then Forward.
- [ ] Storeroom never sees a suggestion before it is forwarded.
