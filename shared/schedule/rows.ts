import type { IsoDate } from './dates';
import { childrenIndex, effectiveOwner, effectiveSpan, isOverdue, ownSpan, sortProjects, union, type ProjectLike, type Span, type TaskLike } from './spans';

export type GanttRow<P extends ProjectLike = ProjectLike, T extends TaskLike = TaskLike> =
  | { kind: 'project'; key: string; project: P; span: Span | null; collapsed: boolean; taskCount: number; overdueCount: number }
  | {
      kind: 'task';
      key: string;
      project: P;
      task: T;
      own: Span | null;
      /** Union of its own window and its sub-tasks' (only differs from `own` when it has sub-tasks). */
      rollup: Span | null;
      hasChildren: boolean;
      childCount: number;
      doneCount: number;
      collapsed: boolean;
      overdue: boolean;
      /** A sub-task runs outside the task's own window. */
      childOutside: boolean;
    }
  | {
      kind: 'subtask';
      key: string;
      project: P;
      parent: T;
      task: T;
      own: Span | null;
      /** The task's window when the sub-task has no dates (drawn as a dashed ghost). */
      inherited: Span | null;
      owner: string | null;
      ownerInherited: boolean;
      overdue: boolean;
      isLast: boolean;
    }
  | { kind: 'add'; key: string; project: P; parent: T | null };

export interface RowFilters {
  categories?: string[];
  /** Effective owner id; '' = unassigned. */
  ownerId?: string | null;
  search?: string;
  unscheduledOnly?: boolean;
  hideDone?: boolean;
}

export interface BuildRowsOptions {
  today: IsoDate;
  collapsedProjects?: ReadonlySet<string>;
  collapsedTasks?: ReadonlySet<string>;
  filters?: RowFilters;
  /** Editors get "+ Add task" / "+ Add sub-task" rows (hidden while filters are active). */
  addRows?: boolean;
}

export function filtersActive(f: RowFilters | undefined): boolean {
  return !!f && (!!f.categories?.length || (f.ownerId !== undefined && f.ownerId !== null) || !!f.search?.trim() || !!f.unscheduledOnly || !!f.hideDone);
}

/**
 * Flattens the plan into Gantt rows: project → task → sub-task (+ ghost "add" rows). Filters keep a matching
 * sub-task's task and project; a project whose name matches the search keeps all its rows.
 */
export function buildRows<P extends ProjectLike, T extends TaskLike>(projects: P[], tasks: T[], opts: BuildRowsOptions): GanttRow<P, T>[] {
  const f = opts.filters ?? {};
  const active = filtersActive(f);
  const q = f.search?.trim().toLowerCase() ?? '';
  const kids = childrenIndex(tasks);
  const tops = new Map<string, T[]>();
  for (const t of kids.get(null) ?? []) {
    const l = tops.get(t.projectId);
    if (l) l.push(t);
    else tops.set(t.projectId, [t]);
  }

  const leafMatches = (t: T, parent: T | null, projectHit: boolean): boolean => {
    if (f.categories?.length && !f.categories.includes(t.category)) return false;
    if (f.ownerId !== undefined && f.ownerId !== null) {
      const owner = parent ? effectiveOwner(t, parent) : t.assigneeId;
      if ((owner ?? '') !== f.ownerId) return false;
    }
    if (f.hideDone && t.done) return false;
    if (f.unscheduledOnly && (parent ? effectiveSpan(t, parent) : ownSpan(t))) return false;
    if (q && !projectHit && !t.title.toLowerCase().includes(q) && !(parent && parent.title.toLowerCase().includes(q))) return false;
    return true;
  };

  const rows: GanttRow<P, T>[] = [];
  for (const project of sortProjects(projects)) {
    const projectHit = !!q && project.name.toLowerCase().includes(q);
    const projectTasks = tops.get(project.id) ?? [];
    const body: GanttRow<P, T>[] = [];
    const spans: (Span | null)[] = [];
    let taskCount = 0;
    let overdueCount = 0;

    for (const task of projectTasks) {
      const children = kids.get(task.id) ?? [];
      const own = ownSpan(task);
      const childSpans = children.map(ownSpan);
      const rollup = union([own, ...childSpans]);
      spans.push(rollup);
      taskCount += 1 + children.length;
      const leafs = children.length ? children : [task];
      for (const l of leafs) {
        const sp = children.length ? effectiveSpan(l, task) : own;
        if (isOverdue(sp, l.done, opts.today)) overdueCount++;
      }

      const visibleChildren = children.filter((s) => !active || leafMatches(s, task, projectHit));
      // A task with sub-tasks stays when any sub-task matches (a title hit on the task passes to its sub-tasks).
      const selfMatch = !active || (children.length ? visibleChildren.length > 0 : leafMatches(task, null, projectHit));
      if (!selfMatch) continue;

      const collapsed = !active && !!opts.collapsedTasks?.has(task.id);
      const childOutside = !!own && childSpans.some((s) => !!s && (s.start < own.start || s.end > own.end));
      body.push({
        kind: 'task',
        key: `t:${task.id}`,
        project,
        task,
        own,
        rollup,
        hasChildren: children.length > 0,
        childCount: children.length,
        doneCount: children.filter((s) => s.done).length,
        collapsed,
        overdue: children.length ? false : isOverdue(own, task.done, opts.today),
        childOutside,
      });
      if (collapsed) continue;
      const shown = active ? visibleChildren : children;
      shown.forEach((s, i) => {
        const sOwn = ownSpan(s);
        const owner = effectiveOwner(s, task);
        body.push({
          kind: 'subtask',
          key: `s:${s.id}`,
          project,
          parent: task,
          task: s,
          own: sOwn,
          inherited: sOwn ? null : own,
          owner,
          ownerInherited: s.assigneeId === null && owner !== null,
          overdue: isOverdue(effectiveSpan(s, task), s.done, opts.today),
          isLast: i === shown.length - 1,
        });
      });
      if (opts.addRows && !active && children.length) body.push({ kind: 'add', key: `a:${task.id}`, project, parent: task });
    }

    if (active && !body.length) continue;
    const collapsed = !active && !!opts.collapsedProjects?.has(project.id);
    rows.push({ kind: 'project', key: `p:${project.id}`, project, span: union(spans), collapsed, taskCount, overdueCount });
    if (collapsed) continue;
    rows.push(...body);
    if (opts.addRows && !active) rows.push({ kind: 'add', key: `a:${project.id}`, project, parent: null });
  }
  return rows;
}
