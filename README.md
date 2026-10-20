# Koochie Calendar

Team planner for Koochie Sports projects — **material procurement, equipment procurement, logistics, installation
and billing** — with a daily to-do list filtered from it.

- **Today**: a project-wise list of the tasks and sub-tasks to work on today (in progress + overdue), with My/All.
- **Planner**: one big Gantt chart; rows are projects → tasks → sub-tasks, columns are dates. Type dates or drag bars.
- **Projects**: start a project from an issued BOQ Maker quote (its Gantt is drafted from the quote's line items), a
  CRM lead, or blank.
- **Task Lists**: the tasks and sub-tasks a project needs, by category, with working days to complete (fixed, or per
  quantity from the quote), what each waits for, and the BOQ words that bring them into a project.

Specification: [`docs/PLAN.md`](docs/PLAN.md). Conventions: [`CLAUDE.md`](CLAUDE.md).

## Development

```bash
npm ci
cp .dev.vars.example .dev.vars        # any long random strings work locally
npm run db:migrate:local
npm run dev                           # http://localhost:5173 — first visit shows "Create the first admin"
npm run seed:demo                     # optional: demo projects/tasks (dev server must be running)
```

The BOQ and CRM bindings are not running locally, so the project picker shows them as unavailable (Blank works).
To try the quote import locally, run any Worker named `koochie-boq` that answers the integration contract
(`GET /api/integration/planner/quotes` and `…/quotes/:id/lines`) with `wrangler dev` alongside `npm run dev`; the
dev registry connects the `BOQ` binding to it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Worker in workerd with local D1 (`.wrangler/state`) |
| `npm run test` | Unit tests (`shared/schedule`) and Worker tests (routes against local D1) |
| `npm run typecheck` | TypeScript for worker/shared and web |
| `npm run build` | `dist/client` + `dist/koochie_calendar/wrangler.json` |
| `npm run db:migrate:local` / `:remote` | Apply `migrations/` to local / production D1 |
| `npm run seed:admin -- you@example.com password "Your Name" [--remote]` | Create or reset an admin |
| `npm run seed:demo [-- --size large]` | Demo data through the local API |
| `npm run screenshots` | Playwright tour of the dev server → `tmp/screens/` |

## Deploying

Production: **https://koochie-calendar.vikramjit.workers.dev** (Worker `koochie-calendar`, D1 `koochie-calendar`
`9b5c14d4-313c-4326-8359-f56e4f4e6d6b`, Cloudflare account of BOQ Maker).

Every push to `main` deploys through Cloudflare **Workers Builds** (Worker → Settings → Build): build command
`npm run build`, deploy command `npx wrangler deploy --config dist/koochie_calendar/wrangler.json`, Node from
`.node-version`. Non-production branch builds are **off** (previews would share the production D1).

- **Secrets** (Worker → Settings → Variables and Secrets): `SESSION_SECRET` (long random string) and
  `INTEGRATION_SECRET` (the same value as on `koochie-boq` and `yourcrm`; it authenticates the project picker's calls).
- **Migrations are not applied by the build.** When a change adds `migrations/NNNN_*.sql`, run
  `npm run db:migrate:remote` before (or right after) pushing it. `0001`–`0003` are already applied to production
  (2026-10-15, recorded in `d1_migrations`, so wrangler skips them); `0004`–`0005` (Task Lists) on 2026-10-20.
  Apply a migration **before** pushing the code that uses it.
- **Production branch** in Workers Builds must be `main`. If a push does not show up under Worker → Deployments
  within a few minutes, check that setting; `npm run deploy` uploads by hand.
- **First run**: the app shows **Create the first admin**; that account becomes `admin`. Later users are created in
  Users with a temporary password and must change it on first sign-in.
- **Project picker**: BOQ quotes come from `GET /api/integration/planner/quotes` on `koochie-boq` (added for this app);
  CRM leads from `GET /api/integration/leads` on `yourcrm`. Both over service bindings with `X-Integration-Secret`.
- **Quote import**: line items come from `GET /api/integration/planner/quotes/:id/lines` on `koochie-boq`
  ([`docs/boq-maker-quote-lines.patch`](docs/boq-maker-quote-lines.patch), on top of BOQ Maker's
  `claude/focused-clarke-f8i3u5` branch; merged and deployed 2026-10-20). If BOQ Maker cannot answer, the import
  says the lines are unavailable and projects are created without tasks.
- **Rollback**: Worker → Deployments → previous version → *Rollback*. D1 has Time Travel
  (`npx wrangler d1 time-travel restore koochie-calendar --timestamp <ISO time>`).

## Roles

| Role | Can |
|---|---|
| admin | Everything, including Users and deleting projects |
| editor | Create/edit projects, tasks, sub-tasks and the Task Lists; tick items done |
| viewer | See everything; change nothing |
