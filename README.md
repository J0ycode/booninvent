# BoonBaby Store Manager

Stock management for retail baby shops: Supplier -> Store Room -> Stores. Multi-tenant, mobile-first, no payment integration.

## Quick start
1. `pnpm install`
2. Copy `.env.example` to `.env.local` and fill in `MONGODB_URI` (a MongoDB Atlas replica set) and `SESSION_SECRET`.
3. `pnpm seed` creates the demo shops. Every demo login uses the password `Demo@12345`: admin@demo.test, owner@demo.test, storeroom@demo.test, storea@demo.test, storeb@demo.test.
4. `pnpm dev`, then open http://localhost:3000

The full setup, sales API and deployment guide is added in Phase 11. See `CLAUDE.md` for the rules and commands.
