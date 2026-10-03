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
