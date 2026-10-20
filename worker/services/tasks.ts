/**
 * Task and sub-task writes (docs/PLAN.md "Behaviour rules"). Every write is one D1 batch that also bumps
 * plan_version, and answers with every row it changed so the browser can patch its cache.
 *
 * - Two levels only: a sub-task's parent must be a top-level task in the same project.
 * - Dates go through normalisePair (both or neither, end ≥ start). A start typed on an undated row with planned
 *   days gets its end from them; a dated row's planned days follow its working length.
 * - Sub-tasks carry their task's category (kept in sync when the task's category changes).
 * - A task with sub-tasks is done exactly when all of them are: ticking it ticks them all, reopening one reopens it.
 * - Picking a Task List task for a task without sub-tasks adds its standard sub-tasks (undated, with their planned
 *   days and dependencies).
 * - Dependencies (finish → start, same project, no loops) are re-applied after every date change by
 *   shared/schedule/deps.ts `propagate`, in the same batch.
 */
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Category } from '@shared/categories';
import type { CreateTaskInput, PatchTaskInput, TaskChanges } from '@shared/schemas/plan';
import { addDays } from '@shared/schedule/dates';
import { DEPENDENCY_PROBLEM_TEXT, dependencyProblem, propagate, type SchedTask } from '@shared/schedule/deps';
import { normalisePair, type DatePair } from '@shared/schedule/pair';
import { ruleDays, type Quantities } from '@shared/schedule/rules';
import { endAfter, workingDays } from '@shared/schedule/workdays';
import { newId, nowIso, schema, type Db } from '../db/client';
import type { SessionUser } from '../auth/session';
import { toCatalogDto } from './catalog';
import { readVersion, writeBatch } from './batch';
import { HttpError } from './http-error';
import { parseQuantities, tasksByIds } from './plan';

type TaskRow = typeof schema.tasks.$inferSelect;
type Stmt = BatchItem<'sqlite'>;

async function getTask(d: Db, id: string): Promise<TaskRow> {
  const [t] = await d.select().from(schema.tasks).where(eq(schema.tasks.id, id));
  if (!t) throw new HttpError(404, 'That task no longer exists');
  return t;
}

async function childrenOf(d: Db, parentId: string): Promise<TaskRow[]> {
  return d.select().from(schema.tasks).where(eq(schema.tasks.parentId, parentId)).orderBy(asc(schema.tasks.sortOrder));
}

/** Owners must be active admins or editors (a viewer could not tick their own item). */
async function checkAssignee(d: Db, assigneeId: string | null | undefined): Promise<void> {
  if (!assigneeId) return;
  const [u] = await d.select({ role: schema.users.role, active: schema.users.active }).from(schema.users).where(eq(schema.users.id, assigneeId));
  if (!u || !u.active || u.role === 'viewer') throw new HttpError(400, 'Tasks can only be assigned to active admins or editors');
}

async function catalogItem(d: Db, id: string | null | undefined) {
  if (!id) return null;
  const [c] = await d.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id));
  if (!c) throw new HttpError(400, 'That Task List entry no longer exists');
  return c;
}

function siblingsWhere(projectId: string, parentId: string | null) {
  return and(eq(schema.tasks.projectId, projectId), parentId === null ? isNull(schema.tasks.parentId) : eq(schema.tasks.parentId, parentId));
}

// ---- Scheduling helpers ----

/** The project's rows as the schedule engine sees them. */
async function projectSched(d: Db, projectId: string): Promise<SchedTask[]> {
  const rows = await d
    .select({
      id: schema.tasks.id,
      projectId: schema.tasks.projectId,
      parentId: schema.tasks.parentId,
      startDate: schema.tasks.startDate,
      endDate: schema.tasks.endDate,
      dependsOnId: schema.tasks.dependsOnId,
      plannedDays: schema.tasks.plannedDays,
    })
    .from(schema.tasks)
    .where(eq(schema.tasks.projectId, projectId));
  return rows;
}

/** Updates for every row whose dates the project's dependencies move (after the in-memory edit `sched`). */
function propagationStmts(d: Db, sched: SchedTask[], user: SessionUser, now: string): { stmts: Stmt[]; ids: string[] } {
  const changes = propagate(sched);
  return {
    stmts: changes.map((c) =>
      d
        .update(schema.tasks)
        .set({ startDate: c.startDate, endDate: c.endDate, plannedDays: workingDays(c.startDate, c.endDate), updatedAt: now, updatedBy: user.id })
        .where(eq(schema.tasks.id, c.id)),
    ),
    ids: changes.map((c) => c.id),
  };
}

function checkDependsOn(sched: SchedTask[], id: string, depId: string | null | undefined): void {
  if (!depId) return;
  const problem = dependencyProblem(sched, id, depId);
  if (problem) throw new HttpError(400, DEPENDENCY_PROBLEM_TEXT[problem]);
}

/** A date edit: normalised, and an undated row with planned days gets its end from them when only a start is typed. */
function editPair(existing: DatePair, patch: Partial<DatePair>, plannedDays: number | null): DatePair {
  if (plannedDays && !existing.startDate && patch.startDate && patch.endDate === undefined) {
    return { startDate: patch.startDate, endDate: endAfter(patch.startDate, plannedDays) };
  }
  return normalisePair(existing, patch);
}

/**
 * Inserts for a Task List task's standard sub-tasks under `task`: planned days from each rule and the task's
 * quantities, and their dependencies (set after all rows exist, so a sub-task may wait for a later one).
 */
async function catalogStepInserts(
  d: Db,
  templateId: string,
  task: { id: string; projectId: string; category: string; quantities: Quantities },
  user: SessionUser,
  now: string,
): Promise<{ stmts: Stmt[]; ids: string[]; sched: SchedTask[] }> {
  const steps = (await d.select().from(schema.catalogItems).where(eq(schema.catalogItems.parentId, templateId)).orderBy(asc(schema.catalogItems.sortOrder))).map(toCatalogDto);
  const idOf = new Map(steps.map((s) => [s.id, newId()]));
  const stmts: Stmt[] = [];
  const sched: SchedTask[] = [];
  steps.forEach((s, i) => {
    const id = idOf.get(s.id)!;
    const plannedDays = ruleDays(s.rule, task.quantities).days;
    stmts.push(
      d.insert(schema.tasks).values({
        id,
        projectId: task.projectId,
        parentId: task.id,
        title: s.name,
        category: task.category,
        catalogItemId: s.id,
        plannedDays,
        sortOrder: i + 1,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
    sched.push({ id, projectId: task.projectId, parentId: task.id, startDate: null, endDate: null, dependsOnId: s.dependsOnId ? idOf.get(s.dependsOnId) ?? null : null, plannedDays });
  });
  for (const s of sched) if (s.dependsOnId) stmts.push(d.update(schema.tasks).set({ dependsOnId: s.dependsOnId }).where(eq(schema.tasks.id, s.id)));
  return { stmts, ids: sched.map((s) => s.id), sched };
}

/** A parent's done flag after its children change: done iff it has children and all are done. */
function parentDoneUpdate(d: Db, parent: TaskRow, childrenDone: boolean[], user: SessionUser, now: string): Stmt | null {
  if (!childrenDone.length) return null;
  const done = childrenDone.every(Boolean);
  if (done === parent.done) return null;
  return d
    .update(schema.tasks)
    .set({ done, doneAt: done ? now : null, doneBy: done ? user.id : null, updatedAt: now, updatedBy: user.id })
    .where(eq(schema.tasks.id, parent.id));
}

// ---- Writes ----

export async function createTask(d: Db, user: SessionUser, input: CreateTaskInput): Promise<TaskChanges> {
  const [project] = await d.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, input.projectId));
  if (!project) throw new HttpError(404, 'That project no longer exists');
  const [existing] = await d.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, input.id));
  if (existing) throw new HttpError(409, 'A task with this id already exists');

  const parentId = input.parentId ?? null;
  const parent = parentId ? await getTask(d, parentId) : null;
  if (parent && (parent.projectId !== input.projectId || parent.parentId !== null)) {
    throw new HttpError(400, 'Sub-tasks go one level deep, under a task of the same project');
  }
  await checkAssignee(d, input.assigneeId);
  const cat = await catalogItem(d, input.catalogItemId);
  const catDto = cat ? toCatalogDto(cat) : null;
  const category: Category = (parent?.category as Category | undefined) ?? input.category ?? (cat?.category as Category | undefined) ?? 'material';
  const quantities: Quantities = input.quantities ?? (parent ? parseQuantities(parent.quantities) : {});
  const steps = !parent && catDto && catDto.parentId === null && input.addCatalogSteps !== false ? await catalogStepInserts(d, catDto.id, { id: input.id, projectId: input.projectId, category, quantities }, user, nowIso()) : null;
  // Planned days: as given, else from the Task List rule (a task with standard sub-tasks takes theirs).
  const plannedDays = input.plannedDays !== undefined ? input.plannedDays : catDto && !steps?.ids.length ? ruleDays(catDto.rule, quantities).days : null;
  const dates = editPair({ startDate: null, endDate: null }, { startDate: input.startDate ?? null, ...(input.endDate !== undefined ? { endDate: input.endDate } : {}) }, plannedDays);
  const now = nowIso();
  const stmts: Stmt[] = [];

  const sched = await projectSched(d, input.projectId);
  const me: SchedTask = { id: input.id, projectId: input.projectId, parentId, ...dates, dependsOnId: null, plannedDays: dates.startDate ? workingDays(dates.startDate, dates.endDate!) : plannedDays };
  sched.push(me, ...(steps?.sched ?? []));
  checkDependsOn(sched, input.id, input.dependsOnId);
  me.dependsOnId = input.dependsOnId ?? null;

  // Position: right after `afterId` (shifting later siblings down), else at the end.
  let sortOrder: number;
  const after = input.afterId ? (await d.select().from(schema.tasks).where(eq(schema.tasks.id, input.afterId)))[0] : undefined;
  if (after && after.projectId === input.projectId && after.parentId === parentId) {
    sortOrder = after.sortOrder + 1;
    stmts.push(
      d
        .update(schema.tasks)
        .set({ sortOrder: sql`${schema.tasks.sortOrder} + 1` })
        .where(and(siblingsWhere(input.projectId, parentId), gt(schema.tasks.sortOrder, after.sortOrder))),
    );
  } else {
    const [m] = await d.select({ max: sql<number>`coalesce(max(${schema.tasks.sortOrder}), 0)` }).from(schema.tasks).where(siblingsWhere(input.projectId, parentId));
    sortOrder = Number(m?.max ?? 0) + 1;
  }

  stmts.push(
    d.insert(schema.tasks).values({
      id: input.id,
      projectId: input.projectId,
      parentId,
      title: input.title,
      category,
      catalogItemId: cat?.id ?? null,
      startDate: dates.startDate,
      endDate: dates.endDate,
      assigneeId: input.assigneeId ?? null,
      notes: input.notes ?? '',
      sortOrder,
      dependsOnId: input.dependsOnId ?? null,
      plannedDays: me.plannedDays,
      quantities: JSON.stringify(parent ? {} : quantities),
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const changed = [input.id];
  if (steps) {
    stmts.push(...steps.stmts);
    changed.push(...steps.ids);
  }
  if (parent) {
    // A new, open sub-task reopens a finished task.
    const siblings = await childrenOf(d, parent.id);
    const upd = parentDoneUpdate(d, parent, [...siblings.map((s) => s.done), false], user, now);
    if (upd) {
      stmts.push(upd);
      changed.push(parent.id);
    }
  }
  const moved = propagationStmts(d, sched, user, now);
  stmts.push(...moved.stmts);
  changed.push(...moved.ids);

  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, changed), deletedIds: [], version };
}

export async function patchTask(d: Db, user: SessionUser, id: string, input: PatchTaskInput): Promise<TaskChanges> {
  const task = await getTask(d, id);
  const isSub = task.parentId !== null;
  const children = isSub ? [] : await childrenOf(d, id);
  const now = nowIso();
  const stmts: Stmt[] = [];
  const changed = new Set<string>([id]);

  if (input.category !== undefined && isSub && input.category !== task.category) {
    throw new HttpError(400, "Sub-tasks use their task's category");
  }
  await checkAssignee(d, input.assigneeId);
  const cat = input.catalogItemId !== undefined ? await catalogItem(d, input.catalogItemId) : undefined;
  const sched = await projectSched(d, task.projectId);
  const me = sched.find((s) => s.id === id)!;
  if (input.dependsOnId !== undefined) checkDependsOn(sched, id, input.dependsOnId);

  const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now, updatedBy: user.id };
  if (input.title !== undefined) set.title = input.title;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.assigneeId !== undefined) set.assigneeId = input.assigneeId;
  if (input.catalogItemId !== undefined) set.catalogItemId = cat?.id ?? null;
  if (input.category !== undefined && !isSub) set.category = input.category;
  // Picking a Task List task sets the category too (unless the edit names one).
  if (cat && !isSub && input.category === undefined && cat.parentId === null) set.category = cat.category;
  if (input.dependsOnId !== undefined) set.dependsOnId = me.dependsOnId = input.dependsOnId;

  let planned = input.plannedDays !== undefined ? input.plannedDays : task.plannedDays;
  // Picking a Task List task without sub-tasks for an undated row: its rule gives the planned days.
  if (cat && input.plannedDays === undefined && !task.startDate && !children.length) {
    const dto = toCatalogDto(cat);
    if (dto.parentId === null || isSub) planned = ruleDays(dto.rule, parseQuantities(task.quantities)).days;
  }
  let pair: DatePair = { startDate: task.startDate, endDate: task.endDate };
  if (input.startDate !== undefined || input.endDate !== undefined) {
    pair = editPair(pair, { ...(input.startDate !== undefined ? { startDate: input.startDate } : {}), ...(input.endDate !== undefined ? { endDate: input.endDate } : {}) }, planned);
  } else if (input.plannedDays && pair.startDate) {
    // A new length for a dated row moves its end.
    pair = { startDate: pair.startDate, endDate: endAfter(pair.startDate, input.plannedDays) };
  }
  if (pair.startDate !== task.startDate || pair.endDate !== task.endDate) {
    set.startDate = pair.startDate;
    set.endDate = pair.endDate;
  }
  if (pair.startDate && pair.endDate) planned = workingDays(pair.startDate, pair.endDate);
  if (planned !== task.plannedDays) set.plannedDays = planned;
  Object.assign(me, pair, { plannedDays: planned });

  if (input.done !== undefined) {
    if (children.length) {
      // Ticking/unticking a task with sub-tasks does the same to all of them.
      for (const ch of children) {
        if (ch.done === input.done) continue;
        stmts.push(
          d
            .update(schema.tasks)
            .set({ done: input.done, doneAt: input.done ? now : null, doneBy: input.done ? user.id : null, updatedAt: now, updatedBy: user.id })
            .where(eq(schema.tasks.id, ch.id)),
        );
        changed.add(ch.id);
      }
    }
    if (input.done !== task.done) {
      set.done = input.done;
      set.doneAt = input.done ? now : null;
      set.doneBy = input.done ? user.id : null;
    }
  }
  stmts.push(d.update(schema.tasks).set(set).where(eq(schema.tasks.id, id)));

  const newCategory = set.category ?? task.category;
  if (!isSub && newCategory !== task.category && children.length) {
    stmts.push(d.update(schema.tasks).set({ category: newCategory, updatedAt: now }).where(eq(schema.tasks.parentId, id)));
    children.forEach((c) => changed.add(c.id));
  }

  if (isSub && input.done !== undefined) {
    const parent = await getTask(d, task.parentId!);
    const siblings = await childrenOf(d, parent.id);
    const upd = parentDoneUpdate(d, parent, siblings.map((s) => (s.id === id ? input.done! : s.done)), user, now);
    if (upd) {
      stmts.push(upd);
      changed.add(parent.id);
    }
  }

  if (!isSub && cat && cat.parentId === null && !children.length && input.addCatalogSteps !== false) {
    const steps = await catalogStepInserts(d, cat.id, { id, projectId: task.projectId, category: newCategory, quantities: parseQuantities(task.quantities) }, user, now);
    // The sub-tasks now carry the durations: an undated task keeps no planned days of its own.
    if (steps.ids.length && !pair.startDate && me.plannedDays !== null) {
      stmts.push(d.update(schema.tasks).set({ plannedDays: null }).where(eq(schema.tasks.id, id)));
      me.plannedDays = null;
    }
    stmts.push(...steps.stmts);
    sched.push(...steps.sched);
    steps.ids.forEach((x) => changed.add(x));
  }

  const moved = propagationStmts(d, sched, user, now);
  stmts.push(...moved.stmts);
  moved.ids.forEach((x) => changed.add(x));

  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, [...changed]), deletedIds: [], version };
}

export async function deleteTask(d: Db, user: SessionUser, id: string): Promise<TaskChanges> {
  const task = await getTask(d, id);
  const children = task.parentId ? [] : await childrenOf(d, id);
  const now = nowIso();
  const stmts: Stmt[] = [d.delete(schema.tasks).where(eq(schema.tasks.id, id))];
  const changed: string[] = [];
  if (task.parentId) {
    const parent = await getTask(d, task.parentId);
    const remaining = (await childrenOf(d, parent.id)).filter((s) => s.id !== id);
    const upd = parentDoneUpdate(d, parent, remaining.map((s) => s.done), user, now);
    if (upd) {
      stmts.push(upd);
      changed.push(parent.id);
    }
  }
  // Rows that waited for a deleted one become independent (ON DELETE SET NULL); a shorter task pulls its followers in.
  const gone = new Set([id, ...children.map((c) => c.id)]);
  const all = await projectSched(d, task.projectId);
  const freed = all.filter((s) => !gone.has(s.id) && s.dependsOnId && gone.has(s.dependsOnId)).map((s) => s.id);
  const sched = all.filter((s) => !gone.has(s.id)).map((s) => (s.dependsOnId && gone.has(s.dependsOnId) ? { ...s, dependsOnId: null } : s));
  const moved = propagationStmts(d, sched, user, now);
  stmts.push(...moved.stmts);
  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, [...changed, ...freed, ...moved.ids]), deletedIds: [...gone], version };
}

/** Moves a task's dates by `days`, together with its sub-tasks' (dragging a summary bar). */
export async function shiftTask(d: Db, user: SessionUser, id: string, days: number): Promise<TaskChanges> {
  const task = await getTask(d, id);
  const now = nowIso();
  const sched = await projectSched(d, task.projectId);
  const affected = sched.filter((s) => (s.id === id || (!task.parentId && s.parentId === id)) && s.startDate && s.endDate);
  if (!affected.length || days === 0) return { tasks: await tasksByIds(d, [id]), deletedIds: [], version: await readVersion(d) };
  const stmts: Stmt[] = [];
  for (const s of affected) {
    s.startDate = addDays(s.startDate!, days);
    s.endDate = addDays(s.endDate!, days);
    stmts.push(d.update(schema.tasks).set({ startDate: s.startDate, endDate: s.endDate, updatedAt: now, updatedBy: user.id }).where(eq(schema.tasks.id, s.id)));
  }
  const moved = propagationStmts(d, sched, user, now);
  stmts.push(...moved.stmts);
  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, [...affected.map((a) => a.id), ...moved.ids]), deletedIds: [], version };
}

/** Rewrites sort_order 1…n for exactly the children of (projectId, parentId). */
export async function reorderTasks(d: Db, projectId: string, parentId: string | null, ids: string[]): Promise<TaskChanges> {
  const siblings = await d.select({ id: schema.tasks.id }).from(schema.tasks).where(siblingsWhere(projectId, parentId));
  const have = new Set(siblings.map((s) => s.id));
  if (have.size !== ids.length || new Set(ids).size !== ids.length || !ids.every((x) => have.has(x))) {
    throw new HttpError(409, 'The list changed while you were moving rows; reload and try again');
  }
  const stmts = ids.map((tid, i) => d.update(schema.tasks).set({ sortOrder: i + 1 }).where(eq(schema.tasks.id, tid)));
  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, ids), deletedIds: [], version };
}
