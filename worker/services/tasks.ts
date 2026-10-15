/**
 * Task and sub-task writes (docs/PLAN.md "Behaviour rules"). Every write is one D1 batch that also bumps
 * plan_version, and answers with every row it changed so the browser can patch its cache.
 *
 * - Two levels only: a sub-task's parent must be a top-level task in the same project.
 * - Dates go through normalisePair (both or neither, end ≥ start).
 * - Sub-tasks carry their task's category (kept in sync when the task's category changes).
 * - A task with sub-tasks is done exactly when all of them are: ticking it ticks them all, reopening one reopens it.
 * - Picking a catalogue task template for a task without sub-tasks adds the template's standard steps (undated).
 */
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import type { Category } from '@shared/categories';
import type { CreateTaskInput, PatchTaskInput, TaskChanges } from '@shared/schemas/plan';
import { normalisePair } from '@shared/schedule/pair';
import { newId, nowIso, schema, type Db } from '../db/client';
import type { SessionUser } from '../auth/session';
import { readVersion, writeBatch } from './batch';
import { HttpError } from './http-error';
import { tasksByIds } from './plan';

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
  if (!c) throw new HttpError(400, 'That catalogue item no longer exists');
  return c;
}

function siblingsWhere(projectId: string, parentId: string | null) {
  return and(eq(schema.tasks.projectId, projectId), parentId === null ? isNull(schema.tasks.parentId) : eq(schema.tasks.parentId, parentId));
}

/** Inserts for a template's standard steps under `task`. */
async function catalogStepInserts(d: Db, templateId: string, task: { id: string; projectId: string; category: string }, user: SessionUser, now: string) {
  const steps = await d.select().from(schema.catalogItems).where(eq(schema.catalogItems.parentId, templateId)).orderBy(asc(schema.catalogItems.sortOrder));
  const ids: string[] = [];
  const stmts: Stmt[] = steps.map((s, i) => {
    const id = newId();
    ids.push(id);
    return d.insert(schema.tasks).values({
      id,
      projectId: task.projectId,
      parentId: task.id,
      title: s.name,
      category: task.category,
      catalogItemId: s.id,
      sortOrder: i + 1,
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    });
  });
  return { stmts, ids };
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
  const category: Category = (parent?.category as Category | undefined) ?? input.category ?? (cat?.category as Category | undefined) ?? 'material';
  const dates = normalisePair({ startDate: null, endDate: null }, { startDate: input.startDate ?? null, endDate: input.endDate ?? null });
  const now = nowIso();
  const stmts: Stmt[] = [];

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
      createdBy: user.id,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const changed = [input.id];
  if (!parent && cat && cat.parentId === null && input.addCatalogSteps !== false) {
    const steps = await catalogStepInserts(d, cat.id, { id: input.id, projectId: input.projectId, category }, user, now);
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

  const set: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now, updatedBy: user.id };
  if (input.title !== undefined) set.title = input.title;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.assigneeId !== undefined) set.assigneeId = input.assigneeId;
  if (input.catalogItemId !== undefined) set.catalogItemId = cat?.id ?? null;
  if (input.category !== undefined && !isSub) set.category = input.category;
  // Picking a template sets the category too (unless the edit names one).
  if (cat && !isSub && input.category === undefined && cat.parentId === null) set.category = cat.category;
  if (input.startDate !== undefined || input.endDate !== undefined) {
    const pair = normalisePair(
      { startDate: task.startDate, endDate: task.endDate },
      { ...(input.startDate !== undefined ? { startDate: input.startDate } : {}), ...(input.endDate !== undefined ? { endDate: input.endDate } : {}) },
    );
    set.startDate = pair.startDate;
    set.endDate = pair.endDate;
  }

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
    const steps = await catalogStepInserts(d, cat.id, { id, projectId: task.projectId, category: newCategory }, user, now);
    stmts.push(...steps.stmts);
    steps.ids.forEach((x) => changed.add(x));
  }

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
  const version = await writeBatch(d, stmts);
  return { tasks: await tasksByIds(d, changed), deletedIds: [id, ...children.map((c) => c.id)], version };
}

/** Moves a task's dates by `days`, together with its sub-tasks' (dragging a summary bar). */
export async function shiftTask(d: Db, user: SessionUser, id: string, days: number): Promise<TaskChanges> {
  const task = await getTask(d, id);
  const now = nowIso();
  const offset = `${days >= 0 ? '+' : ''}${days} days`;
  const where = and(
    task.parentId ? eq(schema.tasks.id, id) : or(eq(schema.tasks.id, id), eq(schema.tasks.parentId, id)),
    sql`${schema.tasks.startDate} IS NOT NULL`,
  );
  const affected = await d.select({ id: schema.tasks.id }).from(schema.tasks).where(where);
  if (!affected.length || days === 0) return { tasks: await tasksByIds(d, [id]), deletedIds: [], version: await readVersion(d) };
  const version = await writeBatch(d, [
    d
      .update(schema.tasks)
      .set({
        startDate: sql`date(${schema.tasks.startDate}, ${offset})`,
        endDate: sql`date(${schema.tasks.endDate}, ${offset})`,
        updatedAt: now,
        updatedBy: user.id,
      })
      .where(where),
  ]);
  return { tasks: await tasksByIds(d, affected.map((a) => a.id)), deletedIds: [], version };
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

