/**
 * Dependencies (finish → start). A dependent task or sub-task starts the working day after the one it depends on
 * ends, and moves whenever that one moves or grows (docs/PLAN.md "Task Lists and dependencies").
 *
 * - A task's end, as a predecessor, is the latest end of the task and its sub-tasks.
 * - A dependent task with sub-tasks moves as a block: its earliest dated member lands on the start day and every
 *   member keeps its working-day offset and length.
 * - An undated dependent gets dates from its planned days (default 1); undated independent sub-tasks of a dependent
 *   task with planned days start with the block.
 * - A task cannot depend on itself, its own task or sub-tasks, a task in another project, or anything that would
 *   close a loop.
 *
 * `propagate` is used by the Worker (the authority, inside the same batch as the edit) and by the browser for the
 * optimistic update, so both agree.
 */
import type { IsoDate } from './dates';
import { endAfter, nextWorkingDay, rollForward, workingDays, workingOffset } from './workdays';

export interface SchedTask {
  id: string;
  projectId: string;
  parentId: string | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  dependsOnId: string | null;
  plannedDays: number | null;
}

export interface DateChange {
  id: string;
  startDate: IsoDate;
  endDate: IsoDate;
}

type Graph = Map<string, Set<string>>;

function edge(g: Graph, from: string, to: string) {
  let s = g.get(from);
  if (!s) g.set(from, (s = new Set()));
  s.add(to);
}

/**
 * Ordering edges: predecessor → dependent, each sub-task of a predecessor → the dependent (the predecessor's end
 * includes them), and task → its sub-tasks (a block moves before its members are placed).
 */
function buildGraph(tasks: SchedTask[]): Graph {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map<string, string[]>();
  for (const t of tasks) if (t.parentId) (kids.get(t.parentId) ?? kids.set(t.parentId, []).get(t.parentId)!).push(t.id);
  const g: Graph = new Map();
  for (const t of tasks) {
    for (const k of kids.get(t.id) ?? []) edge(g, t.id, k);
    const p = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
    if (!p) continue;
    edge(g, p.id, t.id);
    for (const k of kids.get(p.id) ?? []) edge(g, k, t.id);
  }
  return g;
}

/** Kahn's order over the graph; null when there is a loop. */
function topoOrder(tasks: SchedTask[], g: Graph): string[] | null {
  const indeg = new Map(tasks.map((t) => [t.id, 0]));
  for (const tos of g.values()) for (const to of tos) indeg.set(to, (indeg.get(to) ?? 0) + 1);
  const queue = tasks.filter((t) => indeg.get(t.id) === 0).map((t) => t.id);
  const out: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(id);
    for (const to of g.get(id) ?? []) {
      const n = (indeg.get(to) ?? 0) - 1;
      indeg.set(to, n);
      if (n === 0) queue.push(to);
    }
  }
  return out.length === tasks.length ? out : null;
}

export type DependencyProblem = 'self' | 'family' | 'other-project' | 'missing' | 'loop';

export const DEPENDENCY_PROBLEM_TEXT: Record<DependencyProblem, string> = {
  self: 'A task cannot depend on itself',
  family: 'A task and its own sub-tasks cannot depend on each other',
  'other-project': 'Dependencies stay inside one project',
  missing: 'That task no longer exists',
  loop: 'That would make a loop of tasks waiting on each other',
};

/** Why `id` may not depend on `predId` (null = it may). */
export function dependencyProblem(tasks: SchedTask[], id: string, predId: string): DependencyProblem | null {
  const t = tasks.find((x) => x.id === id);
  const p = tasks.find((x) => x.id === predId);
  if (!t || !p) return 'missing';
  if (t.id === p.id) return 'self';
  if (t.projectId !== p.projectId) return 'other-project';
  if (t.parentId === p.id || p.parentId === t.id) return 'family';
  const trial = tasks.filter((x) => x.projectId === t.projectId).map((x) => (x.id === id ? { ...x, dependsOnId: predId } : x));
  return topoOrder(trial, buildGraph(trial)) ? null : 'loop';
}

/** The tasks/sub-tasks `id` may depend on (same project, no loop), in the order given. */
export function dependencyCandidates(tasks: SchedTask[], id: string): string[] {
  const t = tasks.find((x) => x.id === id);
  if (!t) return [];
  return tasks.filter((x) => x.projectId === t.projectId && x.id !== id && !dependencyProblem(tasks, id, x.id)).map((x) => x.id);
}

/**
 * Re-applies every dependency in the given tasks (one or more projects) and returns the rows whose dates change.
 * Tasks whose dependencies form a loop (which writes never allow) are left as they are.
 */
export function propagate(input: SchedTask[]): DateChange[] {
  const tasks = input.map((t) => ({ ...t }));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map<string, SchedTask[]>();
  for (const t of tasks) if (t.parentId && byId.has(t.parentId)) (kids.get(t.parentId) ?? kids.set(t.parentId, []).get(t.parentId)!).push(t);
  const order = topoOrder(tasks, buildGraph(tasks));
  if (!order) return [];

  const before = new Map(input.map((t) => [t.id, `${t.startDate}|${t.endDate}`]));
  const set = (t: SchedTask, start: IsoDate, end: IsoDate) => {
    t.startDate = start;
    t.endDate = end;
  };
  const latestEnd = (t: SchedTask): IsoDate | null => {
    let end = t.endDate;
    for (const k of kids.get(t.id) ?? []) if (k.endDate && (!end || k.endDate > end)) end = k.endDate;
    return end;
  };

  for (const id of order) {
    const t = byId.get(id)!;
    const pred = t.dependsOnId ? byId.get(t.dependsOnId) : undefined;
    if (!pred) continue;
    const pEnd = latestEnd(pred);
    if (!pEnd) continue;
    const target = nextWorkingDay(pEnd);
    const members = kids.get(t.id) ?? [];

    if (!members.length) {
      const len = t.startDate && t.endDate ? workingDays(t.startDate, t.endDate) : t.plannedDays ?? 1;
      set(t, target, endAfter(target, len));
      continue;
    }

    // A block: the task's own window (if any) and its sub-tasks move together.
    const dated = [t, ...members].filter((m) => m.startDate && m.endDate);
    if (dated.length) {
      const anchor = dated.reduce((a, m) => (m.startDate! < a ? m.startDate! : a), dated[0]!.startDate!);
      for (const m of dated) {
        const offset = workingOffset(anchor, m.startDate!);
        const len = workingDays(m.startDate!, m.endDate!);
        const start = endAfter(target, offset + 1);
        set(m, start, endAfter(start, len));
      }
    }
    // Undated, independent sub-tasks with a planned length start with the block.
    for (const m of members) {
      if (!m.startDate && !m.dependsOnId && m.plannedDays) set(m, rollForward(target), endAfter(rollForward(target), m.plannedDays));
    }
  }

  const out: DateChange[] = [];
  for (const t of tasks) {
    if (t.startDate && t.endDate && before.get(t.id) !== `${t.startDate}|${t.endDate}`) out.push({ id: t.id, startDate: t.startDate, endDate: t.endDate });
  }
  return out;
}
