import { maxDate, minDate, type IsoDate } from './dates';

export interface Span {
  start: IsoDate;
  end: IsoDate;
}

/** The minimal task shape the schedule maths needs (TaskDto satisfies it). */
export interface TaskLike {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  category: string;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  assigneeId: string | null;
  done: boolean;
  doneAt: string | null;
  sortOrder: number;
}

export interface ProjectLike {
  id: string;
  name: string;
  status: string;
  sortOrder: number;
}

export function ownSpan(t: Pick<TaskLike, 'startDate' | 'endDate'>): Span | null {
  return t.startDate && t.endDate ? { start: t.startDate, end: t.endDate } : null;
}

export function union(spans: Iterable<Span | null | undefined>): Span | null {
  let out: Span | null = null;
  for (const s of spans) {
    if (!s) continue;
    out = out ? { start: minDate(out.start, s.start), end: maxDate(out.end, s.end) } : { ...s };
  }
  return out;
}

/** A sub-task's working window: its own dates, else its task's (undated standard steps still reach Today). */
export function effectiveSpan(sub: TaskLike, parent: TaskLike | null): Span | null {
  return ownSpan(sub) ?? (parent ? ownSpan(parent) : null);
}

/** A sub-task's owner: its own assignee, else its task's. */
export function effectiveOwner(sub: TaskLike, parent: TaskLike | null): string | null {
  return sub.assigneeId ?? parent?.assigneeId ?? null;
}

export function bySortOrder<T extends { sortOrder: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder;
}

/** parentId → children (sorted); `null` key holds top-level tasks. */
export function childrenIndex<T extends TaskLike>(tasks: T[]): Map<string | null, T[]> {
  const map = new Map<string | null, T[]>();
  for (const t of tasks) {
    const k = t.parentId;
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }
  for (const list of map.values()) list.sort(bySortOrder);
  return map;
}

/** Projects in planner order: sort_order, then name. */
export function sortProjects<P extends ProjectLike>(projects: P[]): P[] {
  return [...projects].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Overdue on `today`: not done and its window ended before today. */
export function isOverdue(span: Span | null, done: boolean, today: IsoDate): boolean {
  return !done && !!span && span.end < today;
}
