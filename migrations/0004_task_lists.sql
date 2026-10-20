-- 0004_task_lists: the Catalogue becomes the Task Lists — duration rules, BOQ matching and dependencies — and tasks
-- gain a dependency, planned working days and the quantities they were drafted from. Append-only: never edit after
-- shipping. No triggers (statements stay splittable on ';').

-- Task List entries: how long they take (shared/schedule/rules.ts), what they wait for, which quote lines feed them.
ALTER TABLE catalog_items ADD COLUMN duration_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (duration_mode IN ('fixed', 'per_qty'));
ALTER TABLE catalog_items ADD COLUMN duration_days REAL NOT NULL DEFAULT 1 CHECK (duration_days > 0);
ALTER TABLE catalog_items ADD COLUMN per_qty REAL CHECK (per_qty IS NULL OR per_qty > 0);   -- per_qty: days per this many units
ALTER TABLE catalog_items ADD COLUMN rate_unit TEXT;                                        -- sqft|sqm|rmt|rft|nos
ALTER TABLE catalog_items ADD COLUMN min_days INTEGER NOT NULL DEFAULT 1 CHECK (min_days >= 1);
-- A task waits for another Task List task; a sub-task for a sibling sub-task (both finish → start).
ALTER TABLE catalog_items ADD COLUMN depends_on_id TEXT REFERENCES catalog_items(id) ON DELETE SET NULL;
ALTER TABLE catalog_items ADD COLUMN boq_match TEXT NOT NULL DEFAULT '[]';                  -- JSON array of words/codes
ALTER TABLE catalog_items ADD COLUMN auto_add INTEGER NOT NULL DEFAULT 0 CHECK (auto_add IN (0, 1)); -- into every quote import

-- Tasks: finish → start dependency on a task/sub-task of the same project (worker/services/tasks.ts checks it),
-- planned working days (used when the row has no dates yet), and quantities by unit as JSON ({"sqft": 8000}).
ALTER TABLE tasks ADD COLUMN depends_on_id TEXT REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN planned_days INTEGER CHECK (planned_days IS NULL OR planned_days >= 1);
ALTER TABLE tasks ADD COLUMN quantities TEXT NOT NULL DEFAULT '{}';
CREATE INDEX tasks_depends ON tasks(depends_on_id);

-- The quote lines a project's tasks were drafted from (copied at import; BOQ Maker is never asked again).
CREATE TABLE project_quote_lines (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  boq_quote_id     TEXT NOT NULL,
  boq_line_id      TEXT NOT NULL,
  area             TEXT NOT NULL DEFAULT '',
  code             TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT '',
  qty              REAL NOT NULL DEFAULT 0,
  optional         INTEGER NOT NULL DEFAULT 0 CHECK (optional IN (0, 1)),
  boq_category     TEXT NOT NULL DEFAULT '',
  included         INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
  catalog_item_ids TEXT NOT NULL DEFAULT '[]',                                           -- the Task List tasks it fed
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX project_quote_lines_project ON project_quote_lines(project_id, sort_order);
