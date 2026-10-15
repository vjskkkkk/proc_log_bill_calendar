-- 0002_planner: the catalogue of common tasks, projects, and their tasks/sub-tasks. Append-only: never edit after shipping.
-- No triggers on purpose: every statement stays a plain `;`-terminated one (safe to split for D1 /query execution).

-- Catalogue: task templates (parent_id NULL) and their standard steps (parent_id = the template).
CREATE TABLE catalog_items (
  id         TEXT PRIMARY KEY,
  category   TEXT NOT NULL,                                          -- material|equipment|logistics|billing (shared/categories.ts)
  parent_id  TEXT REFERENCES catalog_items(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX catalog_items_list ON catalog_items(category, parent_id, sort_order);
CREATE INDEX catalog_items_parent ON catalog_items(parent_id);
CREATE UNIQUE INDEX catalog_items_name ON catalog_items(category, ifnull(parent_id, ''), lower(name));

-- Projects: the Gantt's top-level rows. Details are copied from the BOQ quote / CRM lead they were picked from.
CREATE TABLE projects (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  client            TEXT NOT NULL DEFAULT '',
  location          TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'active',                  -- active|on_hold|completed|archived
  boq_quote_id      TEXT,                                            -- koochie-boq quotes.id picked (newest issued revision then)
  boq_root_quote_id TEXT,                                            -- its revision family: one project per family
  boq_quote_no      TEXT NOT NULL DEFAULT '',                        -- display copy, e.g. 'KS/2026/0123 R1'
  crm_lead_id       TEXT,                                            -- yourcrm lead id: one project per lead
  notes             TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX projects_status ON projects(status, sort_order);
CREATE UNIQUE INDEX projects_boq_root ON projects(boq_root_quote_id);
CREATE UNIQUE INDEX projects_crm_lead ON projects(crm_lead_id);

-- Tasks and sub-tasks (two levels: parent_id NULL = task). Dates are IST calendar days 'YYYY-MM-DD', both or neither.
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,                                     -- sub-tasks mirror their task's (worker/services/tasks.ts)
  catalog_item_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL,
  start_date      TEXT,
  end_date        TEXT,
  assignee_id     TEXT REFERENCES users(id) ON DELETE SET NULL,      -- NULL on a sub-task = the task's owner
  done            INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  done_at         TEXT,
  done_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes           TEXT NOT NULL DEFAULT '',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (start_date IS NULL OR date(start_date) = start_date),
  CHECK (end_date IS NULL OR date(end_date) = end_date),
  CHECK ((start_date IS NULL AND end_date IS NULL) OR (start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date))
);
CREATE INDEX tasks_project ON tasks(project_id, parent_id, sort_order);
CREATE INDEX tasks_parent ON tasks(parent_id);
CREATE INDEX tasks_assignee ON tasks(assignee_id);
CREATE INDEX tasks_catalog ON tasks(catalog_item_id);

INSERT INTO settings (key, value) VALUES ('plan_version', '1');
