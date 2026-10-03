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
