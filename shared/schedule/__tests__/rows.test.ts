import { describe, expect, it } from 'vitest';
import { buildRows } from '../rows';
import { barGeometry, dateAtX, monthSegments, sundayOffset, timelineRange, weekStarts, xOf, ZOOM_PX } from '../timeline';
import type { ProjectLike, TaskLike } from '../spans';

const P = (id: string, sortOrder = 0): ProjectLike => ({ id, name: `Project ${id}`, status: 'active', sortOrder });
const T = (o: Partial<TaskLike> & { id: string; projectId: string }): TaskLike => ({
  parentId: null, title: o.id, category: 'material', startDate: null, endDate: null, assigneeId: null, done: false, doneAt: null, sortOrder: 0, ...o,
});
const today = '2026-10-15';

const projects = [P('a', 1), P('b', 2)];
const tasks = [
  T({ id: 'a1', projectId: 'a', title: 'Turf PO', startDate: '2026-10-10', endDate: '2026-10-12', sortOrder: 1, assigneeId: 'u1' }),
  T({ id: 'a2', projectId: 'a', title: 'Dispatch', category: 'logistics', startDate: '2026-10-14', endDate: '2026-10-20', sortOrder: 2 }),
  T({ id: 'a2s1', projectId: 'a', parentId: 'a2', title: 'Book transporter', category: 'logistics', startDate: '2026-10-14', endDate: '2026-10-25', sortOrder: 1, assigneeId: 'u2' }),
  T({ id: 'a2s2', projectId: 'a', parentId: 'a2', title: 'E-way bill', category: 'logistics', sortOrder: 2 }),
  T({ id: 'b1', projectId: 'b', title: 'Advance invoice', category: 'billing', sortOrder: 1, done: true }),
];

const keys = (rows: ReturnType<typeof buildRows>) => rows.map((r) => r.key);

describe('buildRows', () => {
  it('flattens project → task → sub-task with add rows for editors', () => {
    const rows = buildRows(projects, tasks, { today, addRows: true });
    expect(keys(rows)).toEqual(['p:a', 't:a1', 't:a2', 's:a2s1', 's:a2s2', 'a:a2', 'a:a', 'p:b', 't:b1', 'a:b']);
    const a2 = rows.find((r) => r.key === 't:a2');
    expect(a2?.kind === 'task' && a2.rollup).toEqual({ start: '2026-10-14', end: '2026-10-25' });
    expect(a2?.kind === 'task' && a2.childOutside).toBe(true);
    const ghost = rows.find((r) => r.key === 's:a2s2');
    expect(ghost?.kind === 'subtask' && ghost.inherited).toEqual({ start: '2026-10-14', end: '2026-10-20' });
    const pa = rows.find((r) => r.key === 'p:a');
    expect(pa?.kind === 'project' && pa.span).toEqual({ start: '2026-10-10', end: '2026-10-25' });
    expect(pa?.kind === 'project' && pa.overdueCount).toBe(1);
  });
  it('groups a project into category sections, in category order, collapsible', () => {
    const mixed = [...tasks, T({ id: 'a3', projectId: 'a', title: 'Steel', category: 'material', startDate: '2026-11-01', endDate: '2026-11-02', sortOrder: 3 })];
    const rows = buildRows(projects, mixed, { today, sections: true, addRows: true });
    expect(keys(rows)).toEqual(['p:a', 'c:a:material', 't:a1', 't:a3', 'c:a:logistics', 't:a2', 's:a2s1', 's:a2s2', 'a:a2', 'a:a', 'p:b', 'c:b:billing', 't:b1', 'a:b']);
    const mat = rows.find((r) => r.key === 'c:a:material');
    expect(mat?.kind === 'section' && [mat.span, mat.taskCount, mat.overdueCount]).toEqual([{ start: '2026-10-10', end: '2026-11-02' }, 2, 1]);
    const folded = buildRows(projects, mixed, { today, sections: true, collapsedSections: new Set(['a:logistics']) });
    expect(keys(folded)).toEqual(['p:a', 'c:a:material', 't:a1', 't:a3', 'c:a:logistics', 'p:b', 'c:b:billing', 't:b1']);
    // Filters drop sections left empty.
    expect(keys(buildRows(projects, mixed, { today, sections: true, filters: { categories: ['logistics'] } }))).toEqual(['p:a', 'c:a:logistics', 't:a2', 's:a2s1', 's:a2s2']);
  });
  it('collapses projects and tasks', () => {
    const rows = buildRows(projects, tasks, { today, collapsedProjects: new Set(['b']), collapsedTasks: new Set(['a2']) });
    expect(keys(rows)).toEqual(['p:a', 't:a1', 't:a2', 'p:b']);
  });
  it('filters keep ancestors and drop empty projects', () => {
    expect(keys(buildRows(projects, tasks, { today, addRows: true, filters: { search: 'e-way' } }))).toEqual(['p:a', 't:a2', 's:a2s2']);
    expect(keys(buildRows(projects, tasks, { today, filters: { categories: ['billing'] } }))).toEqual(['p:b', 't:b1']);
    expect(keys(buildRows(projects, tasks, { today, filters: { hideDone: true } }))).toEqual(['p:a', 't:a1', 't:a2', 's:a2s1', 's:a2s2']);
    expect(keys(buildRows(projects, tasks, { today, filters: { unscheduledOnly: true } }))).toEqual(['p:b', 't:b1']);
    expect(keys(buildRows(projects, tasks, { today, filters: { ownerId: 'u2' } }))).toEqual(['p:a', 't:a2', 's:a2s1']);
    expect(keys(buildRows(projects, tasks, { today, filters: { ownerId: '' } }))).toEqual(['p:a', 't:a2', 's:a2s2', 'p:b', 't:b1']);
    expect(keys(buildRows(projects, tasks, { today, filters: { search: 'project b' } }))).toEqual(['p:b', 't:b1']);
  });
});

describe('timeline geometry', () => {
  it('range starts on a Monday and covers the plan plus margins', () => {
    const r = timelineRange([{ start: '2026-08-01', end: '2026-12-01' }], today);
    expect(r.start).toBe('2026-07-27');
    expect(r.end).toBe('2027-04-27'); // today + 180 + 14
  });
  it('x and dateAtX invert each other at every zoom', () => {
    for (const px of Object.values(ZOOM_PX)) {
      const origin = '2026-10-12';
      for (const d of ['2026-10-12', '2026-10-31', '2027-02-28']) {
        expect(dateAtX(xOf(d, origin, px), origin, px)).toBe(d);
        expect(dateAtX(xOf(d, origin, px) + px - 0.5, origin, px)).toBe(d);
      }
    }
  });
  it('bars cover whole days, end inclusive, with a minimum width', () => {
    expect(barGeometry({ start: '2026-10-13', end: '2026-10-15' }, '2026-10-12', 32)).toEqual({ left: 32, width: 96 });
    expect(barGeometry({ start: '2026-10-13', end: '2026-10-13' }, '2026-10-12', 4)).toEqual({ left: 4, width: 6 });
  });
  it('finds Sundays, months and weeks', () => {
    expect(sundayOffset('2026-10-12')).toBe(6);
    expect(sundayOffset('2026-10-18')).toBe(0);
    expect(monthSegments({ start: '2026-10-26', end: '2026-12-02' })).toEqual([
      { label: 'Oct 2026', start: '2026-10-26', days: 6 },
      { label: 'Nov 2026', start: '2026-11-01', days: 30 },
      { label: 'Dec 2026', start: '2026-12-01', days: 2 },
    ]);
    expect(weekStarts({ start: '2026-10-14', end: '2026-10-27' })).toEqual(['2026-10-19', '2026-10-26']);
  });
});
