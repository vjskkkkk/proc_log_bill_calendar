# Koochie Calendar — specification

Status: v1 built 2026-10-15 (all screens, API, tests); deployment waits on the owner steps in “Deployment”. Audience: whoever (human or Claude) works on this repo next.

## Context
The team needs one shared planner for back-office work across current projects:
- material procurement
- equipment procurement
- logistics
- billing

It also needs a daily to-do list built from that planner. The app will be a sibling of BOQ Maker, on the same Cloudflare stack and with the same look. It goes into the empty repo `vjskkkkk/proc_log_bill_calendar`, on branch `claude/focused-clarke-f8i3u5`.

**Decisions taken (user, 2026-10-15):**
- **Today** list: shows active and overdue items. Items can be ticked done from the list.
- **Assignees:** every task and sub-task can have an owner. The Today list has a My/All toggle.
- **Roles:** admin, editor and viewer. Viewers are read-only.
- **Projects:** picked from issued BOQ quotes or CRM leads, or created blank.
- **Name:** Koochie Calendar, at `https://koochie-calendar.vikramjit.workers.dev`.
- **Dates:** typed in the table. Bars can also be dragged to move or resize them.
- **Non-working days:** only Sundays are shaded.

**What already exists:**
- The Cloudflare connector is linked to the user's account (c643aa4c…). It already holds the `koochie-boq`, `yourcrm` and `yourhabuddy` Workers and D1 databases.
- The connector can create D1 databases and run SQL. It cannot deploy Workers or set secrets.

## Infrastructure (cloned from BOQ Maker)

**Stack and versions**
- One Cloudflare Worker: Hono plus Static Assets serving a Vite/React/Tailwind v4 single-page app.
- D1 accessed through Drizzle.
- Pinned versions are identical to BOQ Maker's `package.json`, minus `@cloudflare/puppeteer` and `exceljs`. No R2 or Browser Rendering.

**`wrangler.jsonc`**
- `name: koochie-calendar`, with BOQ's `compatibility_date` and `nodejs_compat`.
- `assets`: single-page-app mode, with `run_worker_first: ["/api/*"]`.
- D1 binding `DB` → `koochie-calendar`.
- Service bindings: `BOQ` → `koochie-boq`, `CRM` → `yourcrm`.
- Vars: `APP_NAME`, `COOKIE_SECURE=auto`.
- Observability turned on.

**Secrets**
- `SESSION_SECRET`.
- `INTEGRATION_SECRET`, with the same value as BOQ and the CRM.

**Deploys**
- Workers Builds on every push to `main`.
- Build command: `npm run build`.
- Deploy command: `npx wrangler deploy --config dist/koochie_calendar/wrangler.json`.
- Migrations are applied by hand, as in BOQ.

**Copied from BOQ almost unchanged**
- `vite.config.ts`, `tsconfig.json`, `vitest.config.ts` and `vitest.workers.config.ts`. The workers config gets fake `BOQ` and `CRM` service bindings.
- `worker/auth/{password,session,middleware}.ts`. The cookie is renamed `koochie_calendar_session`, so it doesn't clash with BOQ on localhost. Middleware adds `canEdit = requireRole('admin','editor')`.
- `worker/routes/{auth,users,health,util}.ts` and `worker/db/client.ts`.
- `shared/schemas/auth.ts`. `shared/types.ts` changes to `Role = admin|editor|viewer`.
- `scripts/seed-admin.ts` and `scripts/copy-brand.ts`.
- `web/src/{main.tsx, App.tsx}`, with the same auth gate, first-admin setup and forced `/change-password` redirect.
- `web/src/api/{client,auth,users}.ts`, `lib/theme.ts`, and the `useCommittedInput` autosave from `lib/money.ts`.
- `components/Field.tsx`, and `pages/{Login,ChangePassword,AdminUsers}.tsx`. The default new-user role becomes editor.
- `index.css`: identical tokens, plus category colours, Gantt helpers and print rules.
- The CI workflow: typecheck, test, build.

**Brand assets**
- Copy `logo_black`/`logo_white` (svg and png) and `app_banner-web.jpg` from `BOQMaker/inputs/brand`.

**Docs**
- `CLAUDE.md`: house rules adapted for this app:
  - All date and schedule maths lives in `shared/schedule`, as pure, unit-tested functions.
  - Dates are `YYYY-MM-DD` in IST.
  - Never write to BOQ or the CRM.
  - Viewers are read-only on the server, with a `roles.test` covering every write route.
  - Migrations are append-only.
  - Desktop-first.
  - Commit after each milestone.
- `README.md`: Dev, Commands, Deploying, Roles.
- `docs/PLAN.md`: the specification, which is this plan.

## Data model (migrations)
**`0001_init.sql`** is BOQ's file (users, sessions, settings) with `role CHECK IN ('admin','editor','viewer')`.

**`0002_planner.sql`** adds three tables.

`catalog_items`
- Columns: `id, category, parent_id, name, sort_order, created_at, updated_at`.
- `parent_id` is NULL for a task template. Otherwise the row is a standard sub-task of that template.
- Unique on `(category, parent, lower(name))`.

`projects`
- Columns: `id, name, client, location, status (active|on_hold|completed|archived), boq_quote_id, boq_root_quote_id, boq_quote_no, crm_lead_id, notes, sort_order, created_by, timestamps`.
- Unique indexes on `boq_root_quote_id` and `crm_lead_id`, so each quote family or lead becomes at most one project.

`tasks`
- Columns: `id, project_id, parent_id, title, category, catalog_item_id, start_date, end_date, assignee_id, done, done_at, done_by, notes, sort_order, created_by, updated_by, timestamps`.
- Two levels only: task and sub-task, enforced in the service.
- CHECKs:
  - both dates are valid `date()` strings;
  - both dates are set or both are NULL;
  - `end >= start`.
- Cascades:
  - deleting a project deletes its tasks;
  - deleting a task deletes its sub-tasks;
  - deleting a user or a catalogue item sets the reference to NULL.

**`0003_catalog_seed.sql`** adds a starter catalogue with fixed ids. Every item can be edited later.

| Category | Starter task templates |
|---|---|
| Material | Turf/court flooring, PU/acrylic coating, sub-base & civil materials, fencing & netting, consumables |
| Equipment | Sports equipment, floodlights & poles, installation machinery |
| Logistics | Dispatch to site, inbound to warehouse, team travel & stay, return of tools |
| Billing | Advance invoice, dispatch invoice, final invoice, vendor bill processing |

Each template carries its standard steps, for example Raise PO → Pay advance → Track dispatch → Receive & inspect.

**Behaviour rules** (implemented in `shared/schedule` and `worker/services/tasks.ts`):
- **Dates:**
  - If only one date is entered, it is copied to the other, giving a one-day bar.
  - If an edit makes end earlier than start, the other date moves to match.
- **Sub-task inheritance:**
  - Sub-tasks copy their task's category.
  - An undated sub-task takes its task's dates.
  - A sub-task with no owner takes its task's owner.
- **Done status:**
  - A task with sub-tasks is done when all of its sub-tasks are done.
  - Ticking the task ticks all its sub-tasks.
  - Reopening a sub-task reopens its task.
- **Change tracking:**
  - A `plan_version` row in `settings` is bumped in the same batch as every write.
  - Open tabs poll `/api/plan/version` every 30 s and refetch only when it changes.

## API (thin Hono routes; logic in `worker/services/*`)
- **Copied from BOQ:** `/api/health`, `/api/auth/*` and `/api/users` (admin only).
- **`GET /api/plan?statuses=`**
  - Projects, tasks and people (id, name, role) in one `d.batch`.
  - `GET /api/plan/version` returns just the version.
- **Projects:**
  - `POST/PATCH /api/projects`. A duplicate quote family or lead gets a 409 that includes the existing project's id.
  - `DELETE /api/projects/:id` is admin only.
  - `POST /api/projects/reorder`.
- **Tasks:**
  - `POST /api/tasks` uses an id generated in the browser. Picking a catalogue template also adds its standard sub-tasks.
  - `PATCH`, `DELETE` and `POST /api/tasks/reorder`.
  - `POST /api/tasks/:id/shift {days}` moves a task together with its sub-tasks.
  - Every write returns the changed rows plus the new version.
- **`GET /api/today?date=&scope=mine|all`** runs the same `selectToday` that the browser uses.
- **Catalogue:** `GET/POST/PATCH/DELETE /api/catalog` and `/reorder`. Admins and editors can write.
- **Links** (always return 200 with `{items, unavailable?}` and never throw; 5 s timeout):
  - `GET /api/links/boq-quotes?q=` calls BOQ.
  - `GET /api/links/crm-leads` calls the CRM's existing `GET /api/integration/leads`.
  - Items already linked to a project carry `linkedProjectId`.
- Every write route runs `requireAuth()` and then `canEdit`. Viewers get a 403.

## Screens
**Shell**
- Same dark top bar as BOQ.
- Nav: **Today** (at `/`, with a badge counting my open and overdue items), Planner, Projects, Catalogue, Users (admin only).
- Right side: BOQ and CRM link buttons, avatar, theme toggle, sign out.

**Today** (the default page)
- Banner strip with a greeting and the date.
- Date controls: ‹ date ›, plus a Today button.
- Toggles: My/All and Hide done. Viewers default to All.
- Chips: Overdue (red), Today, Done x/y.

Which items appear:
- Only active projects count.
- **Candidates:** a task without sub-tasks, or each sub-task, using the dates and owner it inherits.
- **Active:** start ≤ D ≤ end. Labelled "Day k of n" or "Due today".
- **Overdue:** end < D and not done by D. Labelled "Overdue N days (was due 12 Oct)".
- **Future date:** shows active items only.
- **Past date:** reconstructs what was overdue on that day, using `done_at`.
- **Undated items:** counted, with a link to the Planner's Unscheduled filter.

How the list is laid out:
- One card per project, two columns, in the same order as the Planner.
- A task with sub-tasks appears as a group header with progress (3/6) above its listed sub-tasks.
- Each item has a checkbox. Checkboxes are disabled for viewers.
- "Open in planner" jumps to the row and flashes it.
- Pages print cleanly.

**Planner (Gantt)**
- Built in-house, with no chart library.
- **Layout:**
  - One scroll container.
  - The left table columns stick to the left: grip/chevron, Title, Category, Owner, Start, End, Days, ✓. A Compact toggle hides some of them.
  - The header has a month row and a day row, and sticks to the top.
  - Rows are virtualised by hand at 32 px each, so only the visible rows plus a buffer are in the page.
  - Day lines and Sunday stripes are drawn with CSS gradients rather than one element per cell.
- **Controls:**
  - Today line, plus a Today button and the `t` key.
  - Zoom: day / week / month.
- **Bars:**
  - Colour by category: material purple, equipment orange, logistics yellow, billing green.
  - Overdue: red ring.
  - Done: faded, with a ✓.
  - An undated sub-task shows a dashed ghost bar.
  - Tasks with sub-tasks and project rows show summary brackets.
- **Editing:**
  - Inline cells autosave.
  - Date cells accept `12/11`, `12 nov`, `+5` (length in days), and +/- keys, and also have a native date-picker button.
  - The title cell is a **catalogue combobox**:
    - Free text always works.
    - Suggestions are grouped by category, and a sub-task row lists its parent template's steps first.
    - Picking a task template adds its standard sub-tasks, with an "Undo" toast.
    - Editors can choose "Save to catalogue".
- **Keyboard:** Tab, arrow keys, Enter for a new sibling row, Ctrl+Enter for a sub-task, Alt+↑/↓ to reorder, `/` to search.
- **Rows:** "+ Add task" and "+ Add sub-task" ghost rows. Clicking a bar opens a right-hand drawer with all fields and notes.
- **Dragging:**
  - Drag the middle of a bar to move it, or its ends to resize it. Moves snap to whole days and show a date tooltip. Esc cancels, and the view scrolls automatically near the edges.
  - Dragging a task's summary bar shifts the task with its sub-tasks.
  - Dragging on an empty lane draws dates for that row.
- **Reordering:** a grip handle reorders rows among siblings.
- **Filters:** category, owner, project status, search, Unscheduled, Hide done. Collapse state is kept in localStorage.
- Optimistic updates, with mutations queued per task. Viewers get a read-only view with no drag.

**Projects**
- A table with name, client, location, BOQ quote number (links into BOQ), CRM lead, status, date span, and counts of tasks and overdue items.
- Status can be edited inline.
- The **New project** dialog has three tabs:
  - From BOQ quote: searchable.
  - From CRM lead: lost leads hidden, won leads first.
  - Blank.
- Picking a quote or lead pre-fills an editable form. Copied details are stored on the project, so creating a project never depends on BOQ or the CRM being reachable.
- If a source can't be reached, its tab shows an amber notice and the other tabs still work.

**Catalogue**
- Four category sections, each listing templates with their steps.
- Add, rename, delete and reorder.
- Viewers can see it but not change it.

**Users**
- BOQ's page, with the roles admin, editor and viewer.

## BOQ Maker change (repo `vjskkkkk/BOQMaker`, same branch name)
- New `worker/services/planner.ts`, `plannerQuotes(d, {q, limit})`:
  - Takes the newest issued row (`pdf_issued_at` set, not cancelled) per `root_quote_id`. This is the same rule as `crmStatus` in `worker/services/crm.ts`.
  - Keeps only `pdf_issued`, `sent` and `won`.
  - Returns `id, rootQuoteId, quoteNo, displayNo (displayQuoteNo), revision, status, quoteType, clientCompany, clientName, projectName, location, crmLeadId, pdfIssuedAt`.
  - Returns **no money fields**.
- Add `integrationRoutes.get('/planner/quotes')` in `worker/routes/crm.ts`. It sits behind the existing `secretMatches` guard.
- `worker/routes/planner.test.ts` checks:
  - a missing or wrong secret gives 403;
  - drafts are excluded;
  - a revision replaces the earlier row only once it is issued;
  - cancelled quotes are excluded;
  - the `q` filter works;
  - `containsCostFields` returns `[]` and the response has no figure-like keys.
- Update `docs/PLAN.md` §11 "Calendar link" and the README.
- No migration is needed. Until this reaches BOQ's `main`, the Calendar shows "BOQ unavailable" on that tab.

## Build order (a commit after each milestone)
1. Docs: PLAN, CLAUDE.md, README.
2. Scaffold from BOQ: auth with the three roles, brand assets, CI. Done when typecheck, the auth test and the build all pass.
3. `shared/schedule` engine:
   - IST dates, date-pair normalisation, parsing, spans and rollups, `selectToday`, row building, timeline geometry.
   - Fully unit-tested.
4. Migrations 0002 and 0003, applied locally.
5. API for plan, projects, tasks, catalogue and Today, plus the roles test.
6. Links to BOQ and the CRM, with graceful failure. Plus the BOQ endpoint and its test, committed on the BOQ branch.
7. Projects page, Catalogue page and the New project dialog.
8. Today page, plus a `seed:demo` script for local data.
9. Gantt display: virtualised rows, sticky columns and header, bars, zoom, Sunday shading.
10. Gantt editing: inline cells, catalogue combobox, keyboard, add rows, drawer.
11. Gantt dragging: move, resize, draw dates, shift a task with its sub-tasks.
12. Reorder, filters, collapse state, live refresh.
13. Polish: print, dark mode, a screenshots script, docs.
14. Deploy and smoke test (next section).

## Deployment

**Cloudflare resources** (account of BOQ Maker, workers.dev subdomain `vikramjit`):
- D1 `koochie-calendar`, id `9b5c14d4-313c-4326-8359-f56e4f4e6d6b` (location hint APAC), created 2026-10-15 through the
  Cloudflare connector; its id is in `wrangler.jsonc`.
- Worker `koochie-calendar` → https://koochie-calendar.vikramjit.workers.dev, built by Workers Builds from `main`.

**Migrations** are applied by hand (`npm run db:migrate:remote`), never by the build. The first three were applied on
2026-10-15 through the connector's D1 query tool, each file's SQL together with its row in wrangler's own
`d1_migrations` table (`id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT
CURRENT_TIMESTAMP NOT NULL`, name = file name with `.sql`), so `wrangler d1 migrations apply --remote` stays in step.

**One-time setup by the owner**
1. Merge the BOQ Maker branch that adds `GET /api/integration/planner/quotes` (BOQ PLAN §11) into its `main`.
   Until then the "From a BOQ quote" tab shows "BOQ Maker answered HTTP 404".
2. Create `main` in this repo from the working branch and make it the default branch.
3. Cloudflare dashboard → Workers & Pages → Create → **Import a repository** → `vjskkkkk/proc_log_bill_calendar`
   (grant the Cloudflare GitHub app access to it if asked). Worker name `koochie-calendar`; production branch
   `main`; build command `npm run build`; deploy command
   `npx wrangler deploy --config dist/koochie_calendar/wrangler.json`; root `/`. Turn **off** builds for
   non-production branches (preview versions would share the production D1).
4. Worker → Settings → Variables and Secrets: `SESSION_SECRET` (new random value, 40+ characters, e.g.
   `openssl rand -base64 48`) and `INTEGRATION_SECRET` (the **same value** as on `koochie-boq` and `yourcrm`; if it
   is lost, set one new value on all three Workers together).
5. Open the URL straight away and **Create the first admin** (until then, whoever opens it first becomes admin);
   then add the team under Users with temporary passwords.

**Smoke test after the first deploy:** `/api/health` → `{ ok: true, db: "ok" }`; New project → the BOQ tab lists
issued quotes and the CRM tab lists leads.

## Verification
- **Unit tests** (`shared/schedule/__tests__`):
  - The IST midnight boundary.
  - Adding days across month and year ends, and leap days.
  - Date-pair normalisation and date parsing.
  - Spans and inheritance.
  - The full `selectToday` matrix: start and end boundaries, done items, future and past dates, Mine with inherited vs explicit owners, undated items, ordering.
  - That row building and timeline geometry round-trip.
- **Worker tests** (vitest-pool-workers, migrations applied per file):
  - Auth flow with the new roles.
  - `roles.test`: every GET returns 200 for a viewer, and every write returns 403.
  - Project duplicate 409 and delete cascade.
  - Tasks:
    - a third level is rejected;
    - date rules;
    - category sync;
    - the done cascade;
    - shift and reorder;
    - template expansion;
    - a `plan_version` bump on every write.
  - Catalogue: unique names, deletion nulls the task link but keeps the title.
  - Links work in all three failure modes, and the secret header is forwarded.
  - The plan payload contains no emails or password hashes.
- **Local end-to-end:**
  - Setup: `cp .dev.vars.example .dev.vars`, then `npm run db:migrate:local`, `npm run seed:admin`, `npm run dev`, `npm run seed:demo`.
  - `npm run screenshots` uses playwright-core with `/opt/pw-browsers/chromium` at 1440×900. It walks through login and the forced password change, then captures:
    - Today in My and All;
    - the Planner at all three zoom levels;
    - Projects and the New project dialog;
    - Catalogue and Users;
    - dark mode and the viewer role.
  - A scripted drag of a bar by 3 days, then a check of the End cell and the server response.
  - A large seed (about 1,500 rows), then a check that scrolling stays at a p95 frame under 16 ms with fewer than 4,000 DOM nodes.
- **CI:** `npm run typecheck`, `npm test` and `npm run build` must pass before every push.
