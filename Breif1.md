You are building "BoonBaby Store Manager", a simple, professional, multi-tenant stock management web app for retail baby shops (clothing and accessories). Start in plan mode. Before planning, read this whole brief, then:

1. If anything is genuinely blocking, ask me all your questions in ONE batch (maximum 5, each with a recommended default). Do not ask about anything you can reasonably decide yourself.
2. For everything else, pick the sensible default, record it in /docs/DECISIONS.md (decision, reason, alternative), and proceed.
3. Write the plan and task list, then build phase by phase. After each phase: run the app, run tests and lint, check the result at phone, tablet, and desktop sizes, fix problems, commit, and give me a short summary before continuing.

Also create a CLAUDE.md at the repo root with the stack, commands (dev, test, lint, seed), the stock rules and tenant-safety rules below, and the code conventions, and keep it up to date.

APP NAME
- Name shown in the UI, login page, emails, PDFs, and page titles: "BoonBaby Store Manager"
- Repo/package/folder: boonbaby-store-manager. PWA manifest name "BoonBaby Store Manager", short_name "BoonBaby".
- Keep the brand name and logo in one config file (for example /src/config/brand.ts). Use a simple text-logo placeholder until I provide a real logo.

PRODUCT PRINCIPLES
- Simple and professional: only the features listed here. No extras, no "just in case" options, no decorative effects. Each screen has one clear purpose and few controls.
- Fully usable on desktop, tablet, and phone (see Responsive and Device Requirements).
- Correctness first: stock numbers must always be right and auditable.
- NO payment integration of any kind: no payment gateway, no card handling, no online checkout, no subscriptions engine. Money is handled only through the manual Bills feature below.

BUSINESS RULES
- A tenant is one shop with one Store Room (central inventory) and typically 2 Stores. Stock flows Supplier -> Store Room -> Store. Stores never transfer to each other; they can return stock to the Store Room.
- Units are pieces only. No sizes, colors, variants, expiry dates, batches, or cartons. One barcode and one quantity per product per location. Plan for 1,000 to 5,000 products per tenant. No product images in version 1.
- Selling happens in a separate billing module in the same overall system. This app only exposes a sales API that reduces a store's stock; it has no sales or checkout screen.

STACK
- Next.js (App Router) + TypeScript (strict), Tailwind CSS, shadcn/ui, TanStack Table, React Hook Form + Zod
- Backend: Next.js route handlers/server actions with MongoDB (Atlas in production) and Mongoose. No separate API server.
- MongoDB must run as a replica set (Atlas does this by default) because stock changes use multi-document transactions. Do NOT require Docker: for local development use a free MongoDB Atlas cluster via MONGODB_URI, or a local single-node replica set as a documented alternative. Tests use mongodb-memory-server in replica-set mode.
- Auth: email + password (argon2 or bcrypt), secure httpOnly cookie sessions (Auth.js credentials or jose-based), login rate limiting, password reset and invite emails via SMTP (Nodemailer); in development, print emails to the console.
- Barcodes: Code 128 via bwip-js; PDF generation (pdf-lib or pdfkit) for dispatch notes and label sheets; camera scanning with @zxing/browser (USB scanners work as keyboard input in a focused field).
- Tooling: pnpm, ESLint, Prettier, Husky pre-commit (lint + typecheck), Vitest, Playwright (end-to-end at phone, tablet, and desktop sizes), GitHub Actions CI (lint, typecheck, tests, build).
- Config: .env.example documenting every variable; never commit secrets.

TENANT SAFETY (MongoDB has no row-level security, so enforce it in code)
- Every document in every business collection has tenantId. Store-level data also has locationId.
- All database access goes through a data-access layer (/src/server/data/*) whose functions require an authenticated context {userId, tenantId, role, locationIds}. Route handlers and pages must never import Mongoose models directly (enforce with an ESLint restriction). The data layer injects tenantId (and locationId for STORE_STAFF) into every query and write; tenantId is never taken from request input.
- Add automated tests proving: one tenant can never read or write another tenant's data; STORE_STAFF can never see another store; STORE_STAFF can never see cost prices or bills; every API route rejects unauthenticated and wrong-role requests.
- Cost price is stored in a separate collection (productCosts) that is only queried for OWNER and STOREROOM_MANAGER; it must never appear in any response to STORE_STAFF.

ROLES AND PORTALS
- Roles: PLATFORM_ADMIN (the product owner, not tied to any shop), OWNER, STOREROOM_MANAGER, STORE_STAFF. Users belong to a tenant and, for STORE_STAFF, to one store.
- Portals by role after login: PLATFORM_ADMIN -> /admin, OWNER -> /owner, STOREROOM_MANAGER -> /storeroom, STORE_STAFF -> /store. Each portal has its own navigation and shows only what that role needs. The tenant comes from the signed-in user's session. Keep tenant resolution in one module so per-shop subdomains (for example shop.yourdomain.com) can be added later without refactoring; do not build subdomains now.
- Signup creates the tenant, its Store Room, the first Store, and the OWNER user. The Owner can add a second store and invite users (name, email, role, store). A script (pnpm create-platform-admin) creates the PLATFORM_ADMIN user; it cannot be created through the UI.

DATA MODEL (refine details but keep these concepts)
tenants (name, slug, status ACTIVE | SUSPENDED), locations (STORE_ROOM | STORE), users, suppliers, products (name, category CLOTHING | ACCESSORY, sku, barcode, sellingPrice, supplierId, reorderLevel, active), productCosts, stockLevels (tenantId, productId, locationId, quantity; unique on the three), stockMovements (append-only ledger: productId, locationId, type, quantityDelta, refType, refId, userId, note, createdAt), receipts (+lines), dispatches (+lines), restockRequests (+lines), returnDamageEntries, bills, labelPrintLog, auditLog, apiKeys (hashed).
Movement types: RECEIPT, DISPATCH_OUT, DISPATCH_IN, SALE, RETURN_OUT, RETURN_IN, DAMAGE, SUPPLIER_RETURN, ADJUSTMENT.
Indexes: tenantId on everything; unique (tenantId, barcode) and (tenantId, sku); unique (tenantId, productId, locationId) on stockLevels; (tenantId, productId, locationId, createdAt) on stockMovements; unique (tenantId, externalRef) for sales idempotency; text/prefix search support on product name.

STOCK RULES (implement in one module, /src/server/stock, using MongoDB transactions; never update quantities anywhere else)
1. stockLevels change only through stock functions that write a stockMovements row in the same transaction. The ledger is append-only; no route may edit or delete movements.
2. Stock can never go negative: use an atomic conditional update (decrement only if quantity >= amount) and fail with a clear, plain-language error.
3. receiveStock(): supplier, invoice number, lines (product, quantity, optional cost). Adds to Store Room stock. Allowed: STOREROOM_MANAGER, OWNER.
4. Dispatch: Draft -> Dispatched. Sending deducts Store Room stock (DISPATCH_OUT) and marks the lines in transit for the destination store.
5. Store receipt: store staff enter the received quantity per line and flag missing and/or damaged quantity with a note. Good quantity is added to store stock (DISPATCH_IN). If anything is missing or damaged, the dispatch becomes "Received with issues" and appears in the Store Room's discrepancy list; the Store Room Manager resolves each one by returning the quantity to Store Room stock or writing it off. Both write ledger movements.
6. Returns and damaged: staff create an entry (type, product, quantity, reason). Store-to-Store-Room returns and write-offs need approval by STOREROOM_MANAGER or OWNER; stock changes only on approval.
7. Sales API: POST /api/v1/sales authenticated by a per-tenant API key (stored hashed; the Owner can create and rotate it in Settings). Body: locationId, externalRef, items [{barcode, quantity}]. Idempotent on externalRef, reduces that store's stock, returns clear error codes. Expose the same function internally for the in-system billing module. Document both in the README.
8. Every state-changing action writes an auditLog entry.
9. Every mutating request is protected against double submission (disable buttons while pending and accept an idempotency key).

RESTOCK REQUESTS
- Manual: store staff search products, enter quantities, submit.
- Suggested: an on-demand "Suggest restock" button (no background jobs) lists store products at or below reorderLevel with suggested quantity = max(1, reorderLevel * 2 - current quantity). Suggestions are private to the store and shown as "Waiting for Staff Approval". Staff must Approve / Edit / Skip each line and press "Forward to Store Room". The Store Room sees a request only after it is forwarded.
- Status flow: Draft -> Waiting for Staff Approval (suggested only) -> Sent -> Approved or Rejected -> Dispatched. Approving creates a pre-filled draft dispatch in one click.

BILLS (manual, replaces any payment integration)
Purpose: record bills and mark them paid or unpaid by hand. No money moves through the app.
One bills collection with two kinds:
1. SUPPLIER bills (inside each shop): the shop's purchase bills from suppliers. Fields: supplier, bill number, bill date, due date, amount (store as integer paise, show in INR), optional note, optional link to a stock receipt. Visible and editable only to OWNER and STOREROOM_MANAGER; STORE_STAFF cannot see them.
2. PLATFORM bills (issued to a shop by the PLATFORM_ADMIN): fields: tenant, bill number, description, amount, issue date, due date. Created only by PLATFORM_ADMIN. The shop's OWNER can view them read-only on a "Billing" page and cannot edit or mark them.
Rules for both kinds:
- Status is UNPAID or PAID. Marking PAID records paidDate (default today), who marked it, and an optional free-text note such as "Paid by UPI" or "Cash". Allow marking back to UNPAID (logged in auditLog).
- "Overdue" is a computed label (UNPAID and past due date), shown as a red chip; never stored.
- Bills list: filter by status (All, Unpaid, Overdue, Paid), date range, and supplier or tenant; show totals for unpaid and overdue amounts; export CSV. One-click "Mark paid" from the list and the detail view, with a small confirm dialog.
- Dashboard cards: total unpaid and overdue count/amount (OWNER and STOREROOM_MANAGER for supplier bills; PLATFORM_ADMIN for platform bills).
- Bills may be edited or deleted only while UNPAID; paid bills are locked unless first marked unpaid.
Platform admin area (/admin), kept minimal: list of shops with name, owner email, status, unpaid platform bills; open a shop to add platform bills, mark them paid/unpaid, and set the shop ACTIVE or SUSPENDED. A SUSPENDED shop can sign in but is read-only (all stock actions rejected with a clear message). There is no automatic suspension.

BARCODES AND LABELS
- Every product gets a unique barcode on creation (auto-generated Code 128 value unless an existing one is entered; unique per tenant).
- Barcode Labels page: pick products individually or "all items from a recent receipt"; labels per product; A4 sticker sheet presets (24, 40, 65 per sheet); optional start position on a partly used sheet via a clickable grid; live preview; Print and Download PDF. Each label shows product name, price, SKU, and barcode. Log each print.
- A scan-capable search field on every inventory screen. On phone and tablet, a camera button opens a full-screen scanner with an item card and a quantity stepper.

SCREENS (minimal; each one earns its place)
Store Room: Dashboard (total products, total pieces, low-stock items, pending requests, unpaid bills, recent activity); Products (searchable, filterable, paginated; add/edit; CSV import with validation preview); Receive Stock; Dispatch (+ printable dispatch note PDF); Restock Requests; Returns and Damaged (+ discrepancies); Barcode Labels; Bills; Reports.
Store: Dashboard; My Stock; Incoming Dispatches; Request Restock (manual + suggested); Return or Report Damaged; Stock History.
Owner: Dashboard comparing Store Room, Store A, Store B (pieces, low-stock counts, one bar chart, pending approvals, unpaid bills); Reports with location filter; Bills (supplier bills plus the read-only platform Billing page); Users and Locations; Settings (company details, API key).
Platform admin: Shops list and shop detail with platform bills (as above).
Reports (date filters, CSV export only): stock list, low stock, dispatch history by store, damaged and returns, stock movement history, bills summary.
Plus: login, password reset, a notification bell (low stock, pending approvals, dispatches to confirm, overdue bills; computed on load, no realtime), and a short first-run checklist for new shops. Do not build anything not listed here.

RESPONSIVE AND DEVICE REQUIREMENTS (hard requirements)
- Mobile-first. Verified at 360x800 (phone), 768x1024 and 1024x768 (tablet), 1280x800 and 1920x1080 (desktop). Nothing may overflow horizontally at any size.
- Navigation: desktop = left sidebar with 5-7 items; tablet = collapsed icon rail with large touch targets; phone = bottom navigation (Home, Stock, Scan, Requests, More) with a central Scan button. Respect safe-area insets.
- Data tables become compact stacked cards on phone; forms are single column on phone with correct input types and numeric keypads for quantities.
- Touch targets at least 44px, no hover-only interactions, sticky primary action bar on phone.
- Installable PWA (manifest, icons, standalone display). Camera scanning must work in the installed app on Android and iOS Safari, with a clear fallback to typing the code if permission is denied. Offline support is NOT required beyond a friendly "you are offline" message.
- Performance: server-side pagination and search for product lists (never load all 5,000 products), debounced search, Lighthouse mobile score of 90 or higher for performance, accessibility, and best practices on the main screens.
- Accessibility: keyboard navigable, visible focus, labels on every input, WCAG AA contrast, respects reduced motion.
- Graceful handling of slow connections: loading states, retry on failure, no double submissions.

VISUAL DESIGN (professional, restrained)
- Clean business-grade UI: neutral base, one primary accent (soft teal), and soft pastel tints (mint, powder blue, peach, lavender) used sparingly for status chips and chart series. No heavy gradients and no animation beyond subtle transitions.
- Light and dark themes (follow system, with a toggle). If I attach exported Stitch designs, match them closely.
- Rounded sans-serif font (Nunito or Poppins) with tabular numbers for quantities and amounts; consistent spacing; 12px radius; subtle shadows.
- Build a small shared component set first (page header, data table, status chip, stat card, empty state, confirm dialog, scanner sheet, form fields) and reuse it everywhere.
- Clear microcopy, helpful empty states, confirmation for destructive actions, toast feedback.

PHASES (stop after each for my review)
1. Repo setup, tooling, CI, MongoDB connection and test setup, data-access layer, auth, tenancy, roles, portal routing, responsive app shell, create-platform-admin script, seed data with demo logins for every role, and the tenant/role isolation tests.
2. Products, suppliers, productCosts, barcode generation, CSV import, and the scan/search component.
3. The stock module, Receive Stock, and tests for every stock rule above.
4. Dispatch, store receipt with missing/damaged flags, discrepancy resolution.
5. Restock requests (manual + suggested with staff approval).
6. Returns and damaged, and the sales API with idempotency and docs.
7. Barcode label sheets (A4 presets, start position, PDF).
8. Bills: supplier bills, platform bills, the /admin area, overdue labels, totals, CSV export, and tests for the bills visibility rules.
9. Dashboards, reports, notifications.
10. PWA, device pass (phone, tablet, desktop), accessibility pass, performance pass.
11. Production readiness: MongoDB Atlas setup, environment variables, deployment steps (for example Vercel + Atlas), backup note, error logging, and a README with full setup and deployment instructions.

DEFINITION OF DONE
Lint, typecheck, unit, and end-to-end tests pass in CI; a fresh clone runs with documented commands and seeded demo logins for each role; isolation tests prove tenant, store, cost-price, and bills access rules; every screen works at phone, tablet, and desktop sizes; no payment integration exists anywhere in the code; the README documents setup, environment variables, the sales API, and deployment.