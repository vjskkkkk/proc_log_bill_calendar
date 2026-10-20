import { describe, expect, it } from 'vitest';
import { dependencyCandidates, dependencyProblem, propagate, type SchedTask } from '../deps';

const T = (p: Partial<SchedTask> & { id: string }): SchedTask => ({ projectId: 'p', parentId: null, startDate: null, endDate: null, dependsOnId: null, plannedDays: null, ...p });
const apply = (tasks: SchedTask[]) => {
  const ch = new Map(propagate(tasks).map((c) => [c.id, c]));
  return Object.fromEntries(tasks.map((t) => [t.id, ch.has(t.id) ? `${ch.get(t.id)!.startDate}..${ch.get(t.id)!.endDate}` : `${t.startDate}..${t.endDate}`]));
};

describe('propagate', () => {
  it('starts a dependent the working day after its predecessor, keeping its working length', () => {
    const out = apply([
      T({ id: 'a', startDate: '2026-10-19', endDate: '2026-10-23' }), // Mon–Fri
      T({ id: 'b', startDate: '2026-10-01', endDate: '2026-10-03', dependsOnId: 'a' }), // 3 working days
    ]);
    expect(out.b).toBe('2026-10-24..2026-10-27'); // Sat, (Sun), Mon, Tue
  });

  it('skips Sunday when the predecessor ends on Saturday', () => {
    const out = apply([T({ id: 'a', startDate: '2026-10-24', endDate: '2026-10-24' }), T({ id: 'b', startDate: '2026-10-01', endDate: '2026-10-01', dependsOnId: 'a' })]);
    expect(out.b).toBe('2026-10-26..2026-10-26');
  });

  it('moves a chain when the first link moves, and pulls it back when it shrinks', () => {
    const chain = (end: string) => [
      T({ id: 'a', startDate: '2026-10-19', endDate: end }),
      T({ id: 'b', startDate: '2026-10-20', endDate: '2026-10-21', dependsOnId: 'a' }),
      T({ id: 'c', startDate: '2026-10-22', endDate: '2026-10-22', dependsOnId: 'b' }),
    ];
    expect(apply(chain('2026-10-19'))).toMatchObject({ b: '2026-10-20..2026-10-21', c: '2026-10-22..2026-10-22' });
    expect(apply(chain('2026-10-22'))).toMatchObject({ b: '2026-10-23..2026-10-24', c: '2026-10-26..2026-10-26' });
    expect(propagate(chain('2026-10-19'))).toEqual([]); // already consistent: nothing to write
  });

  it('gives an undated dependent its planned days', () => {
    const out = apply([T({ id: 'a', startDate: '2026-10-19', endDate: '2026-10-19' }), T({ id: 'b', dependsOnId: 'a', plannedDays: 4 })]);
    expect(out.b).toBe('2026-10-20..2026-10-23');
  });

  it('leaves dependents of an unscheduled task alone', () => {
    expect(propagate([T({ id: 'a' }), T({ id: 'b', startDate: '2026-10-19', endDate: '2026-10-19', dependsOnId: 'a' })])).toEqual([]);
  });

  it("uses a task's latest sub-task end as its end", () => {
    const out = apply([
      T({ id: 'a' }),
      T({ id: 'a1', parentId: 'a', startDate: '2026-10-19', endDate: '2026-10-20' }),
      T({ id: 'a2', parentId: 'a', startDate: '2026-10-21', endDate: '2026-10-28' }),
      T({ id: 'b', startDate: '2026-10-01', endDate: '2026-10-01', dependsOnId: 'a' }),
    ]);
    expect(out.b).toBe('2026-10-29..2026-10-29');
  });

  it('moves a dependent task with its sub-tasks as a block, keeping offsets', () => {
    const out = apply([
      T({ id: 'a', startDate: '2026-10-19', endDate: '2026-10-19' }),
      T({ id: 'b', dependsOnId: 'a' }),
      T({ id: 'b1', parentId: 'b', startDate: '2026-10-05', endDate: '2026-10-06' }),
      T({ id: 'b2', parentId: 'b', startDate: '2026-10-07', endDate: '2026-10-07', dependsOnId: 'b1' }),
    ]);
    expect(out).toMatchObject({ b1: '2026-10-20..2026-10-21', b2: '2026-10-22..2026-10-22' });
  });

  it('starts undated independent steps of a dependent task with the block', () => {
    const out = apply([
      T({ id: 'a', startDate: '2026-10-19', endDate: '2026-10-19' }),
      T({ id: 'b', dependsOnId: 'a' }),
      T({ id: 'b1', parentId: 'b', plannedDays: 2 }),
      T({ id: 'b2', parentId: 'b', plannedDays: 3, dependsOnId: 'b1' }),
    ]);
    expect(out).toMatchObject({ b1: '2026-10-20..2026-10-21', b2: '2026-10-22..2026-10-24' });
  });

  it('follows sub-task to sub-task links across tasks', () => {
    const out = apply([
      T({ id: 'a' }),
      T({ id: 'a1', parentId: 'a', startDate: '2026-10-19', endDate: '2026-10-21' }),
      T({ id: 'b' }),
      T({ id: 'b1', parentId: 'b', startDate: '2026-10-19', endDate: '2026-10-19', dependsOnId: 'a1' }),
    ]);
    expect(out.b1).toBe('2026-10-22..2026-10-22');
  });
});

describe('dependency rules', () => {
  const tasks = [
    T({ id: 'a' }),
    T({ id: 'a1', parentId: 'a' }),
    T({ id: 'b', dependsOnId: 'a' }),
    T({ id: 'b1', parentId: 'b' }),
    T({ id: 'x', projectId: 'q' }),
  ];

  it('rejects self, family, other projects and loops', () => {
    expect(dependencyProblem(tasks, 'a', 'a')).toBe('self');
    expect(dependencyProblem(tasks, 'a1', 'a')).toBe('family');
    expect(dependencyProblem(tasks, 'a', 'a1')).toBe('family');
    expect(dependencyProblem(tasks, 'a', 'x')).toBe('other-project');
    expect(dependencyProblem(tasks, 'a', 'b')).toBe('loop');
    expect(dependencyProblem(tasks, 'a', 'b1')).toBe('loop'); // a's block would wait on b's sub-task, which waits on a
    expect(dependencyProblem(tasks, 'a1', 'b1')).toBe('loop');
    expect(dependencyProblem(tasks, 'b1', 'a1')).toBeNull();
    expect(dependencyProblem(tasks, 'a', 'nope')).toBe('missing');
  });

  it('lists only allowed predecessors', () => {
    expect(dependencyCandidates(tasks, 'a')).toEqual([]);
    expect(dependencyCandidates(tasks, 'b1')).toEqual(['a', 'a1']);
  });
});
