import { diffDays, istDateOf, type IsoDate } from './dates';
import { childrenIndex, effectiveOwner, effectiveSpan, ownSpan, sortProjects, type ProjectLike, type Span, type TaskLike } from './spans';

export type TodayScope = 'mine' | 'all';

export interface TodayOptions {
  /** The day being viewed. */
  date: IsoDate;
  /** The real today (IST); overdue only exists for date ≤ today. */
  today: IsoDate;
  userId: string;
  scope: TodayScope;
}

export interface TodayItem<T extends TaskLike = TaskLike> {
  task: T;
  /** The window used: own dates, or the task's for an undated sub-task. */
  span: Span;
  inheritedDates: boolean;
  owner: string | null;
  inheritedOwner: boolean;
  kind: 'active' | 'overdue';
  /** Active: day k of n. */
  dayIndex: number;
  dayCount: number;
  /** Overdue: whole calendar days past the end date, as of `date`. */
  overdueDays: number;
  /** Done (now). For an overdue item on a past date this is the "finished later" case. */
  done: boolean;
}

export interface TodayGroup<T extends TaskLike = TaskLike> {
  /** The top-level task. When it has sub-tasks it is only a header, never an item itself. */
  task: T;
  isHeader: boolean;
  progress: { done: number; total: number };
  items: TodayItem<T>[];
}

export interface TodayProject<P extends ProjectLike = ProjectLike, T extends TaskLike = TaskLike> {
  project: P;
  groups: TodayGroup<T>[];
}

export interface TodayCounts {
  /** Active and not done. */
  active: number;
  overdue: number;
  /** Active and already done. */
  done: number;
  /** Candidates in scope with no dates at all. */
  unscheduled: number;
  /** "Mine" only: items listed under All that have no owner. */
  unassigned: number;
  /** Future dates only: items overdue as of the real today (in scope). */
  overdueNow: number;
}

export interface TodayResult<P extends ProjectLike = ProjectLike, T extends TaskLike = TaskLike> {
  date: IsoDate;
  projects: TodayProject<P, T>[];
  counts: TodayCounts;
}

interface Candidate<T> {
  task: T;
  parent: T | null;
  span: Span | null;
  owner: string | null;
}

function doneBy(t: TaskLike, date: IsoDate): boolean {
  if (!t.done) return false;
  return !t.doneAt || istDateOf(t.doneAt) <= date;
}

type Classified = { kind: 'active' | 'overdue' } | null;

function classify(c: { task: TaskLike; span: Span }, date: IsoDate, today: IsoDate): Classified {
  if (c.span.start <= date && date <= c.span.end) return { kind: 'active' };
  if (date <= today && c.span.end < date && !doneBy(c.task, date)) return { kind: 'overdue' };
  return null;
}

/**
 * Today's list (docs/PLAN.md §5): every task/sub-task whose window covers `date`, plus — for date ≤ today — unfinished
 * ones whose window has ended. A task with sub-tasks is never an item; its sub-tasks are, using the task's dates and
 * owner when they have none. Only active projects count. Order follows the planner (projects, tasks, sub-tasks).
 */
export function selectToday<P extends ProjectLike, T extends TaskLike>(projects: P[], tasks: T[], opts: TodayOptions): TodayResult<P, T> {
  const { date, today, userId, scope } = opts;
  const activeProjects = sortProjects(projects.filter((p) => p.status === 'active'));
  const projectIds = new Set(activeProjects.map((p) => p.id));
  const kids = childrenIndex(tasks.filter((t) => projectIds.has(t.projectId)));
  const topByProject = new Map<string, T[]>();
  for (const t of kids.get(null) ?? []) {
    const list = topByProject.get(t.projectId);
    if (list) list.push(t);
    else topByProject.set(t.projectId, [t]);
  }

  const counts: TodayCounts = { active: 0, overdue: 0, done: 0, unscheduled: 0, unassigned: 0, overdueNow: 0 };
  const inScope = (owner: string | null) => scope === 'all' || owner === userId;
  const out: TodayProject<P, T>[] = [];

  for (const project of activeProjects) {
    const groups: TodayGroup<T>[] = [];
    for (const top of topByProject.get(project.id) ?? []) {
      const children = kids.get(top.id) ?? [];
      const candidates: Candidate<T>[] = children.length
        ? children.map((s) => ({ task: s, parent: top, span: effectiveSpan(s, top), owner: effectiveOwner(s, top) }))
        : [{ task: top, parent: null, span: ownSpan(top), owner: top.assigneeId }];

      const items: TodayItem<T>[] = [];
      for (const c of candidates) {
        if (!c.span) {
          if (inScope(c.owner)) counts.unscheduled++;
          continue;
        }
        const span = c.span;
        if (date > today && inScope(c.owner) && classify({ task: c.task, span }, today, today)?.kind === 'overdue') counts.overdueNow++;
        const cls = classify({ task: c.task, span }, date, today);
        if (!cls) continue;
        if (!inScope(c.owner)) {
          if (scope === 'mine' && c.owner === null) counts.unassigned++;
          continue;
        }
        const item: TodayItem<T> = {
          task: c.task,
          span,
          inheritedDates: !!c.parent && !ownSpan(c.task),
          owner: c.owner,
          inheritedOwner: !!c.parent && c.task.assigneeId === null && c.owner !== null,
          kind: cls.kind,
          dayIndex: diffDays(span.start, date) + 1,
          dayCount: diffDays(span.start, span.end) + 1,
          overdueDays: cls.kind === 'overdue' ? diffDays(span.end, date) : 0,
          done: c.task.done,
        };
        if (cls.kind === 'overdue') counts.overdue++;
        else if (c.task.done) counts.done++;
        else counts.active++;
        items.push(item);
      }
      if (items.length) {
        groups.push({
          task: top,
          isHeader: children.length > 0,
          progress: { done: children.filter((s) => s.done).length, total: children.length },
          items,
        });
      }
    }
    if (groups.length) out.push({ project, groups });
  }
  return { date, projects: out, counts };
}
