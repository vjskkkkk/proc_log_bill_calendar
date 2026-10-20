import { describe, expect, it } from 'vitest';
import { call, setupTeam, uuid } from '../test/helpers';

async function project(cookie: string, name = 'Project') {
  return (await call('POST', '/api/projects', { name }, cookie)).body.project.id as string;
}
async function addTask(cookie: string, body: Record<string, unknown>) {
  const res = await call('POST', '/api/tasks', { id: uuid(), title: 'Task', ...body }, cookie);
  if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
async function plan(cookie: string) {
  return (await call('GET', '/api/plan', undefined, cookie)).body;
}

describe('tasks', () => {
  it('creates tasks and sub-tasks, two levels only, same project', async () => {
    const t = await setupTeam();
    const p1 = await project(t.editor);
    const p2 = await project(t.editor, 'Other');
    const task = await addTask(t.editor, { projectId: p1, category: 'logistics', title: 'Dispatch' });
    const tid = task.tasks[0].id;
    const sub = await addTask(t.editor, { projectId: p1, parentId: tid, category: 'billing', title: 'Book truck' });
    expect(sub.tasks.find((x: any) => x.id !== tid && x.title === 'Book truck').category).toBe('logistics'); // inherits
    const subId = sub.tasks.find((x: any) => x.title === 'Book truck').id;
    expect((await call('POST', '/api/tasks', { id: uuid(), projectId: p1, parentId: subId, title: 'Too deep' }, t.editor)).status).toBe(400);
    expect((await call('POST', '/api/tasks', { id: uuid(), projectId: p2, parentId: tid, title: 'Wrong project' }, t.editor)).status).toBe(400);
    expect((await call('POST', '/api/tasks', { id: tid, projectId: p1, title: 'Dup id' }, t.editor)).status).toBe(409);
  });

  it('keeps dates both-or-neither and end ≥ start', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const one = await addTask(t.editor, { projectId: p, startDate: '2026-10-20' });
    expect(one.tasks[0]).toMatchObject({ startDate: '2026-10-20', endDate: '2026-10-20' });
    const id = one.tasks[0].id;
    const moved = await call('PATCH', `/api/tasks/${id}`, { endDate: '2026-10-10' }, t.editor);
    expect(moved.body.tasks[0]).toMatchObject({ startDate: '2026-10-10', endDate: '2026-10-10' });
    const longer = await call('PATCH', `/api/tasks/${id}`, { endDate: '2026-10-14' }, t.editor);
    expect(longer.body.tasks[0]).toMatchObject({ startDate: '2026-10-10', endDate: '2026-10-14' });
    const cleared = await call('PATCH', `/api/tasks/${id}`, { startDate: null }, t.editor);
    expect(cleared.body.tasks[0]).toMatchObject({ startDate: null, endDate: null });
    expect((await call('PATCH', `/api/tasks/${id}`, { startDate: '2026-02-30' }, t.editor)).status).toBe(400);
  });

  it('syncs category to sub-tasks and cascades done both ways', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const parent = (await addTask(t.editor, { projectId: p, category: 'material', title: 'Turf' })).tasks[0].id;
    const a = (await addTask(t.editor, { projectId: p, parentId: parent, title: 'A' })).tasks.find((x: any) => x.title === 'A').id;
    const b = (await addTask(t.editor, { projectId: p, parentId: parent, title: 'B' })).tasks.find((x: any) => x.title === 'B').id;

    const recat = await call('PATCH', `/api/tasks/${parent}`, { category: 'equipment' }, t.editor);
    expect(recat.body.tasks.map((x: any) => x.category)).toEqual(['equipment', 'equipment', 'equipment']);
    expect((await call('PATCH', `/api/tasks/${a}`, { category: 'billing' }, t.editor)).status).toBe(400);

    // Ticking both sub-tasks finishes the task; reopening one reopens it.
    await call('PATCH', `/api/tasks/${a}`, { done: true }, t.editor);
    let rows = (await call('PATCH', `/api/tasks/${b}`, { done: true }, t.editor)).body.tasks;
    expect(rows.find((x: any) => x.id === parent).done).toBe(true);
    rows = (await call('PATCH', `/api/tasks/${a}`, { done: false }, t.editor)).body.tasks;
    expect(rows.find((x: any) => x.id === parent).done).toBe(false);
    // Ticking the task ticks all its sub-tasks.
    rows = (await call('PATCH', `/api/tasks/${parent}`, { done: true }, t.editor)).body.tasks;
    expect(rows.every((x: any) => x.done)).toBe(true);
    expect(rows.find((x: any) => x.id === a).doneById).toBe(t.ids.editor);
    // A new open sub-task reopens the finished task.
    rows = (await addTask(t.editor, { projectId: p, parentId: parent, title: 'C' })).tasks;
    expect(rows.find((x: any) => x.id === parent).done).toBe(false);
    // Deleting the open one finishes it again.
    const c = rows.find((x: any) => x.title === 'C').id;
    const del = await call('DELETE', `/api/tasks/${c}`, undefined, t.editor);
    expect(del.body.deletedIds).toEqual([c]);
    expect(del.body.tasks.find((x: any) => x.id === parent).done).toBe(true);
  });

  it('adds a Task List task’s sub-tasks with planned days and their chain of dependencies', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const created = await addTask(t.editor, { projectId: p, title: 'Dispatch from warehouse to site', catalogItemId: 'tl-l-dispatch' });
    const parent = created.tasks.find((x: any) => x.parentId === null);
    expect(parent).toMatchObject({ category: 'logistics', plannedDays: null });
    const steps = created.tasks.filter((x: any) => x.parentId === parent.id).sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    expect(steps.map((s: any) => s.title)).toEqual(['Pack & load material', 'Arrange transporter & e-way bill', 'Transit to site', 'Unload & store at site']);
    expect(steps.map((s: any) => s.plannedDays)).toEqual([1, 1, 4, 1]);
    expect(steps.map((s: any) => s.dependsOnId)).toEqual([null, steps[0].id, steps[1].id, steps[2].id]);
    expect(steps.every((s: any) => s.startDate === null && s.category === 'logistics')).toBe(true);

    // A start on the first step schedules the whole chain (Sunday 25 Oct is skipped).
    const started = await call('PATCH', `/api/tasks/${steps[0].id}`, { startDate: '2026-10-22' }, t.editor);
    const byId = Object.fromEntries(started.body.tasks.map((x: any) => [x.id, x]));
    expect([0, 1, 2, 3].map((i) => `${byId[steps[i].id].startDate}..${byId[steps[i].id].endDate}`)).toEqual([
      '2026-10-22..2026-10-22',
      '2026-10-23..2026-10-23',
      '2026-10-24..2026-10-28',
      '2026-10-29..2026-10-29',
    ]);

    // Picking a Task List task later on a plain task does the same; opting out does not.
    const plain = (await addTask(t.editor, { projectId: p, title: 'Billing', category: 'billing' })).tasks[0].id;
    const picked = await call('PATCH', `/api/tasks/${plain}`, { title: 'Final invoice & payment', catalogItemId: 'tl-b-final' }, t.editor);
    expect(picked.body.tasks.filter((x: any) => x.parentId === plain)).toHaveLength(3);
    const none = await addTask(t.editor, { projectId: p, title: 'Advance invoice', catalogItemId: 'tl-b-advance', addCatalogSteps: false });
    expect(none.tasks).toHaveLength(1);
    expect(none.tasks[0].plannedDays).toBe(1); // the task's own rule
  });

  it('keeps dependents after their predecessor as it moves, grows or goes', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const other = await project(t.editor, 'Other');
    const a = (await addTask(t.editor, { projectId: p, title: 'A', startDate: '2026-10-19', endDate: '2026-10-23' })).tasks[0].id;
    const b = (await addTask(t.editor, { projectId: p, title: 'B', startDate: '2026-10-01', endDate: '2026-10-02' })).tasks[0].id;
    const x = (await addTask(t.editor, { projectId: other, title: 'X' })).tasks[0].id;

    const dep = await call('PATCH', `/api/tasks/${b}`, { dependsOnId: a }, t.editor);
    expect(dep.body.tasks.find((r: any) => r.id === b)).toMatchObject({ dependsOnId: a, startDate: '2026-10-24', endDate: '2026-10-26' });
    const grown = await call('PATCH', `/api/tasks/${a}`, { endDate: '2026-10-27' }, t.editor);
    expect(grown.body.tasks.find((r: any) => r.id === b)).toMatchObject({ startDate: '2026-10-28', endDate: '2026-10-29' });
    const shifted = await call('POST', `/api/tasks/${a}/shift`, { days: -7 }, t.editor);
    expect(shifted.body.tasks.find((r: any) => r.id === b)).toMatchObject({ startDate: '2026-10-21', endDate: '2026-10-22' });
    // A dependent's start is set by what it waits for (typing a later start only changes its length).
    const typed = await call('PATCH', `/api/tasks/${b}`, { startDate: '2026-11-10' }, t.editor);
    expect(typed.body.tasks.find((r: any) => r.id === b)).toMatchObject({ startDate: '2026-10-21', endDate: '2026-10-21' });

    expect((await call('PATCH', `/api/tasks/${a}`, { dependsOnId: b }, t.editor)).status).toBe(400); // loop
    expect((await call('PATCH', `/api/tasks/${a}`, { dependsOnId: a }, t.editor)).status).toBe(400);
    expect((await call('PATCH', `/api/tasks/${a}`, { dependsOnId: x }, t.editor)).status).toBe(400); // other project
    const sub = (await addTask(t.editor, { projectId: p, parentId: a, title: 'a1' })).tasks.find((r: any) => r.title === 'a1').id;
    expect((await call('PATCH', `/api/tasks/${sub}`, { dependsOnId: a }, t.editor)).status).toBe(400); // its own task

    // A new row can be created waiting for another, taking its planned days.
    const c = await addTask(t.editor, { projectId: p, title: 'C', dependsOnId: b, plannedDays: 3 });
    expect(c.tasks.find((r: any) => r.title === 'C')).toMatchObject({ startDate: '2026-10-22', endDate: '2026-10-24' });

    const del = await call('DELETE', `/api/tasks/${a}`, undefined, t.editor);
    expect(del.body.tasks.find((r: any) => r.id === b)).toMatchObject({ dependsOnId: null, startDate: '2026-10-21' });
  });

  it('uses planned days for a typed start, and a new length moves the end', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const id = (await addTask(t.editor, { projectId: p, title: 'Cure', plannedDays: 5 })).tasks[0].id;
    const r1 = await call('PATCH', `/api/tasks/${id}`, { startDate: '2026-10-22' }, t.editor);
    expect(r1.body.tasks[0]).toMatchObject({ startDate: '2026-10-22', endDate: '2026-10-27', plannedDays: 5 });
    const r2 = await call('PATCH', `/api/tasks/${id}`, { plannedDays: 2 }, t.editor);
    expect(r2.body.tasks[0]).toMatchObject({ endDate: '2026-10-23', plannedDays: 2 });
    const r3 = await call('PATCH', `/api/tasks/${id}`, { endDate: '2026-10-31' }, t.editor);
    expect(r3.body.tasks[0].plannedDays).toBe(9);
  });

  it('inserts after a sibling, reorders, and shifts a task with its sub-tasks', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const a = (await addTask(t.editor, { projectId: p, title: 'A' })).tasks[0].id;
    const c = (await addTask(t.editor, { projectId: p, title: 'C' })).tasks[0].id;
    const b = (await addTask(t.editor, { projectId: p, title: 'B', afterId: a })).tasks[0].id;
    const order = () => plan(t.editor).then((pl) => pl.tasks.filter((x: any) => x.projectId === p && !x.parentId).sort((x: any, y: any) => x.sortOrder - y.sortOrder).map((x: any) => x.title));
    expect(await order()).toEqual(['A', 'B', 'C']);
    expect((await call('POST', '/api/tasks/reorder', { projectId: p, parentId: null, ids: [c, a, b] }, t.editor)).status).toBe(200);
    expect(await order()).toEqual(['C', 'A', 'B']);
    expect((await call('POST', '/api/tasks/reorder', { projectId: p, parentId: null, ids: [c, a] }, t.editor)).status).toBe(409);

    await call('PATCH', `/api/tasks/${a}`, { startDate: '2026-10-28', endDate: '2026-11-02' }, t.editor);
    const s1 = (await addTask(t.editor, { projectId: p, parentId: a, title: 's1', startDate: '2026-10-30', endDate: '2026-10-31' })).tasks.find((x: any) => x.title === 's1').id;
    await addTask(t.editor, { projectId: p, parentId: a, title: 's2' }); // undated: stays undated
    const shifted = await call('POST', `/api/tasks/${a}/shift`, { days: 3 }, t.editor);
    const byId = Object.fromEntries(shifted.body.tasks.map((x: any) => [x.id, x]));
    expect(byId[a]).toMatchObject({ startDate: '2026-10-31', endDate: '2026-11-05' });
    expect(byId[s1]).toMatchObject({ startDate: '2026-11-02', endDate: '2026-11-03' });
    expect(shifted.body.tasks).toHaveLength(2);
  });

  it('bumps plan_version on every write', async () => {
    const t = await setupTeam();
    const v = async () => (await call('GET', '/api/plan/version', undefined, t.viewer)).body.version as string;
    const v0 = await v();
    const p = await project(t.editor);
    const v1 = await v();
    expect(Number(v1)).toBeGreaterThan(Number(v0));
    const res = await addTask(t.editor, { projectId: p });
    expect(res.version).toBe(await v());
    expect(Number(res.version)).toBeGreaterThan(Number(v1));
  });
});
