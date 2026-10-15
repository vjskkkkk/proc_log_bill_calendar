import { describe, expect, it } from 'vitest';
import { selectToday } from '../today';
import type { ProjectLike, TaskLike } from '../spans';

const P = (id: string, sortOrder: number, status = 'active'): ProjectLike => ({ id, name: id.toUpperCase(), status, sortOrder });
let n = 0;
const T = (o: Partial<TaskLike> & { projectId: string }): TaskLike => ({
  id: o.id ?? `t${++n}`,
  parentId: null,
  title: o.id ?? 'task',
  category: 'material',
  startDate: null,
  endDate: null,
  assigneeId: null,
  done: false,
  doneAt: null,
  sortOrder: 0,
  ...o,
});

const today = '2026-10-15';
const ME = 'u-me';
const YOU = 'u-you';

function ids(r: ReturnType<typeof selectToday>): string[] {
  return r.projects.flatMap((p) => p.groups.flatMap((g) => g.items.map((i) => `${i.task.id}:${i.kind}`)));
}

describe('selectToday', () => {
  const projects = [P('b', 2), P('a', 1), P('hold', 0, 'on_hold')];
  const tasks: TaskLike[] = [
    T({ id: 'covers', projectId: 'a', startDate: '2026-10-13', endDate: '2026-10-17', assigneeId: ME, sortOrder: 1 }),
    T({ id: 'starts', projectId: 'a', startDate: '2026-10-15', endDate: '2026-10-15', assigneeId: ME, sortOrder: 2 }),
    T({ id: 'ended', projectId: 'a', startDate: '2026-10-10', endDate: '2026-10-12', assigneeId: ME, sortOrder: 3 }),
    T({ id: 'endedDone', projectId: 'a', startDate: '2026-10-10', endDate: '2026-10-12', assigneeId: ME, done: true, doneAt: '2026-10-12T10:00:00Z', sortOrder: 4 }),
    T({ id: 'future', projectId: 'a', startDate: '2026-10-16', endDate: '2026-10-20', assigneeId: ME, sortOrder: 5 }),
    T({ id: 'undated', projectId: 'a', assigneeId: ME, sortOrder: 6 }),
    T({ id: 'activeDone', projectId: 'a', startDate: '2026-10-14', endDate: '2026-10-16', assigneeId: ME, done: true, doneAt: '2026-10-14T10:00:00Z', sortOrder: 7 }),
    // Parent with sub-tasks: never an item itself.
    T({ id: 'parent', projectId: 'b', startDate: '2026-10-01', endDate: '2026-10-30', assigneeId: YOU, sortOrder: 1 }),
    T({ id: 'subInherit', projectId: 'b', parentId: 'parent', sortOrder: 1 }),
    T({ id: 'subMine', projectId: 'b', parentId: 'parent', startDate: '2026-10-15', endDate: '2026-10-16', assigneeId: ME, sortOrder: 2 }),
    T({ id: 'subLate', projectId: 'b', parentId: 'parent', startDate: '2026-10-05', endDate: '2026-10-08', sortOrder: 3 }),
    T({ id: 'unowned', projectId: 'b', startDate: '2026-10-15', endDate: '2026-10-15', sortOrder: 2 }),
    T({ id: 'onHold', projectId: 'hold', startDate: '2026-10-15', endDate: '2026-10-15', assigneeId: ME }),
  ];

  it('lists active and overdue items in planner order (All)', () => {
    const r = selectToday(projects, tasks, { date: today, today, userId: ME, scope: 'all' });
    expect(r.projects.map((p) => p.project.id)).toEqual(['a', 'b']);
    expect(ids(r)).toEqual([
      'covers:active',
      'starts:active',
      'ended:overdue',
      'activeDone:active',
      'subInherit:active',
      'subMine:active',
      'subLate:overdue',
      'unowned:active',
    ]);
    expect(r.counts).toMatchObject({ active: 5, overdue: 2, done: 1, unscheduled: 1 });
  });

  it('labels days and overdue spans', () => {
    const r = selectToday(projects, tasks, { date: today, today, userId: ME, scope: 'all' });
    const items = r.projects.flatMap((p) => p.groups.flatMap((g) => g.items));
    const covers = items.find((i) => i.task.id === 'covers')!;
    expect([covers.dayIndex, covers.dayCount]).toEqual([3, 5]);
    expect(items.find((i) => i.task.id === 'ended')!.overdueDays).toBe(3);
    const inh = items.find((i) => i.task.id === 'subInherit')!;
    expect(inh.inheritedDates).toBe(true);
    expect(inh.span).toEqual({ start: '2026-10-01', end: '2026-10-30' });
    expect(inh.owner).toBe(YOU);
    expect(inh.inheritedOwner).toBe(true);
  });

  it('groups sub-tasks under their task as a header with progress', () => {
    const r = selectToday(projects, tasks, { date: today, today, userId: ME, scope: 'all' });
    const g = r.projects[1]!.groups[0]!;
    expect(g.task.id).toBe('parent');
    expect(g.isHeader).toBe(true);
    expect(g.progress).toEqual({ done: 0, total: 3 });
  });

  it('Mine uses the effective owner; explicit sub-task owners win; counts unassigned', () => {
    const r = selectToday(projects, tasks, { date: today, today, userId: ME, scope: 'mine' });
    expect(ids(r)).toEqual(['covers:active', 'starts:active', 'ended:overdue', 'activeDone:active', 'subMine:active']);
    // subInherit/subLate inherit YOU from their task, so only `unowned` has no owner at all.
    expect(r.counts.unassigned).toBe(1);
  });

  it('a past date reconstructs what was overdue then, including items finished later', () => {
    const late = T({ id: 'finishedLater', projectId: 'a', startDate: '2026-10-01', endDate: '2026-10-05', assigneeId: ME, done: true, doneAt: '2026-10-12T05:00:00Z' });
    const r = selectToday([P('a', 1)], [late], { date: '2026-10-08', today, userId: ME, scope: 'all' });
    expect(ids(r)).toEqual(['finishedLater:overdue']);
    expect(r.projects[0]!.groups[0]!.items[0]!.done).toBe(true);
    const after = selectToday([P('a', 1)], [late], { date: '2026-10-13', today, userId: ME, scope: 'all' });
    expect(ids(after)).toEqual([]);
  });

  it('a future date lists active items only and counts what is overdue now', () => {
    const r = selectToday(projects, tasks, { date: '2026-10-16', today, userId: ME, scope: 'mine' });
    expect(ids(r)).toEqual(['covers:active', 'future:active', 'activeDone:active', 'subMine:active']);
    expect(r.counts.overdue).toBe(0);
    expect(r.counts.overdueNow).toBe(1);
  });

  it('skips projects that are not active', () => {
    const r = selectToday(projects, tasks, { date: today, today, userId: ME, scope: 'all' });
    expect(ids(r).some((s) => s.startsWith('onHold'))).toBe(false);
  });
});
