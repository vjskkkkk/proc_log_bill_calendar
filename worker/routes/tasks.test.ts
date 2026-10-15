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

  it('adds a template’s standard steps when a catalogue task is picked', async () => {
    const t = await setupTeam();
    const p = await project(t.editor);
    const created = await addTask(t.editor, { projectId: p, title: 'Dispatch to site', catalogItemId: 'cat-logistics-01' });
    const parent = created.tasks.find((x: any) => x.parentId === null);
    expect(parent.category).toBe('logistics');
    const steps = created.tasks.filter((x: any) => x.parentId === parent.id);
    expect(steps.map((s: any) => s.title)).toEqual(['Book transporter', 'Packing list & e-way bill', 'Load at warehouse', 'Track in transit', 'Unload & GRN at site']);
    expect(steps.every((s: any) => s.startDate === null && s.category === 'logistics')).toBe(true);
    // Picking a template later on a plain task does the same; opting out does not.
    const plain = (await addTask(t.editor, { projectId: p, title: 'Billing', category: 'billing' })).tasks[0].id;
    const picked = await call('PATCH', `/api/tasks/${plain}`, { title: 'Final invoice', catalogItemId: 'cat-billing-03' }, t.editor);
    expect(picked.body.tasks.filter((x: any) => x.parentId === plain)).toHaveLength(4);
    const none = await addTask(t.editor, { projectId: p, title: 'Advance invoice', catalogItemId: 'cat-billing-01', addCatalogSteps: false });
    expect(none.tasks).toHaveLength(1);
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
