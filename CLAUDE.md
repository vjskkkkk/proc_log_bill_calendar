# Koochie Calendar — working conventions

Read `docs/PLAN.md` first: it is the specification. The sibling app **BOQ Maker** (`vjskkkkk/BOQMaker`, Worker
`koochie-boq`) is the reference for infrastructure, auth and look; match it unless `docs/PLAN.md` says otherwise.

## Stack
Cloudflare Worker (Hono, TypeScript) + Static Assets serving a Vite/React/Tailwind v4 SPA; D1 via Drizzle; service
bindings to `koochie-boq` (`BOQ`) and `yourcrm` (`CRM`) for the project picker. Node ≥ 22, npm. Every push to `main`
deploys via Workers Builds; migrations are applied by hand — see README "Deploying".

## Commands
- `npm run dev` — Vite + workerd with local D1                 - `npm run test` — vitest (schedule engine, API, roles)
- `npm run typecheck` — tsc --noEmit (worker + web)               - `npm run build` — dist/client + dist/koochie_calendar
- `npm run db:migrate:local` / `db:migrate:remote` — apply `migrations/`
- `npm run seed:admin -- <email> <password> [name] [--remote]`    - `npm run seed:demo` — demo projects via the local API
- `npm run screenshots` — Playwright tour of the running dev server into `tmp/screens/`

## Hard rules
1. **All date and schedule maths lives in `shared/schedule`** — pure functions, unit-tested. UI and Worker only call
   it (Today selection, date-pair rules, rollups, Gantt geometry, date parsing, working days, duration rules,
   dependency propagation, quote import plans).
2. **Dates are IST calendar days as `'YYYY-MM-DD'` strings** (no `Date` objects in the DB or engine). Timestamps
   (`created_at`, `done_at`) are UTC ISO strings. IST = UTC+05:30, no DST: use offset arithmetic, not `Intl`.
3. **A task's dates are both set or both empty**, `end ≥ start` (SQL CHECK + `normalisePair`). Two levels only:
   task → sub-task.
4. **Viewers are read-only on the server.** Every write route uses `canEdit` (or `requireRole('admin')`) and is listed
   in `worker/routes/roles.test.ts`.
5. **Never write to BOQ Maker or the CRM.** Copy what a project needs when it is linked; the planner and Today never
   call them. Link calls degrade to `{ items: [], unavailable }` instead of failing.
6. **Every planner write bumps `settings.plan_version`** in the same `db.batch` (open tabs poll it to refresh).
7. **Migrations are append-only** (`migrations/NNNN_name.sql`); never edit a shipped migration. No triggers (statements
   must stay splittable on `;` for D1 query execution).
8. No secrets in the repo. `SESSION_SECRET`, `INTEGRATION_SECRET` are Worker secrets; local dev uses `.dev.vars`.
9. **Desktop-first**: ≥ 1280 px wide screens, dense tables; no phone layouts.
10. Prefer boring, well-supported libraries; pin versions; keep the dependency list short (no Gantt/UI libraries).
11. **Commit after every milestone** with a descriptive message on the working branch.
12. Brand assets: `logo_black` on light backgrounds, `logo_white` on dark ones (source of truth: `inputs/brand/`).

## Roles
`admin` (everything incl. users and deleting projects), `editor` (plans, projects, Task Lists, ticks done),
`viewer` (read-only). Only active admins/editors can own tasks.

## Style
TypeScript strict; zod schemas in `shared/schemas` shared by client and server; Hono routes thin, logic in
`worker/services`; React pages thin, data via TanStack Query hooks in `web/src/api`.
