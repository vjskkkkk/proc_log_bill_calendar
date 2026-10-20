import { describe, expect, it } from 'vitest';
import { call, setupTeam, uuid } from '../test/helpers';

const fixed = (days: number) => ({ mode: 'fixed', days, perQty: null, unit: null, minDays: 1 });

describe('Task Lists', () => {
  it('ships the starting Task Lists in five categories, with rules, matches and dependencies', async () => {
    const t = await setupTeam();
    const items = (await call('GET', '/api/catalog', undefined, t.viewer)).body.items as any[];
    const tasks = items.filter((i) => !i.parentId);
    expect(new Set(tasks.map((i) => i.category))).toEqual(new Set(['material', 'equipment', 'logistics', 'installation', 'billing']));
    expect(tasks.length).toBe(48);
    expect(items.some((i) => i.id.startsWith('cat-'))).toBe(false); // the 0003 starter catalogue is replaced
    const turf = items.find((i) => i.id === 'tl-m-turf');
    expect(turf.boqMatch).toContain('verde');
    const steps = items.filter((i) => i.parentId === 'tl-m-turf');
    expect(steps[0]).toMatchObject({ name: 'Confirm turf spec, colours & quantity', dependsOnId: null, rule: fixed(1) });
    expect(steps[1].dependsOnId).toBe(steps[0].id);
    expect(steps.find((s) => s.name === 'Production / stock allocation').rule).toEqual({ mode: 'per_qty', days: 1, perQty: 4000, unit: 'sqft', minDays: 10 });
    expect(items.find((i) => i.id === 'tl-i-turf').dependsOnId).toBe('tl-m-turf');
    expect(items.find((i) => i.id === 'tl-b-advance').autoAdd).toBe(true);
  });

  it('adds, renames, reorders and refuses duplicates', async () => {
    const t = await setupTeam();
    const add = await call('POST', '/api/catalog', { category: 'billing', name: 'Retention release invoice' }, t.editor);
    expect(add.status).toBe(201);
    expect(add.body.item.rule).toEqual(fixed(1)); // a new entry takes one day unless told otherwise
    const id = add.body.item.id;
    expect((await call('POST', '/api/catalog', { category: 'billing', name: 'retention RELEASE invoice' }, t.editor)).status).toBe(409);
    // Same name is fine in another category.
    expect((await call('POST', '/api/catalog', { category: 'logistics', name: 'Retention release invoice' }, t.editor)).status).toBe(201);
    const step = await call('POST', '/api/catalog', { category: 'material', parentId: id, name: 'Raise invoice' }, t.editor);
    expect(step.body.item).toMatchObject({ category: 'billing', parentId: id }); // follows its task
    expect((await call('POST', '/api/catalog', { category: 'billing', parentId: step.body.item.id, name: 'Too deep' }, t.editor)).status).toBe(400);
    const renamed = await call('PATCH', `/api/catalog/${id}`, { name: 'Retention invoice' }, t.editor);
    expect(renamed.body.items.find((i: any) => i.id === id).name).toBe('Retention invoice');

    const billing = (await call('GET', '/api/catalog', undefined, t.editor)).body.items.filter((i: any) => i.category === 'billing' && !i.parentId);
    const reversed = billing.map((i: any) => i.id).reverse();
    const re = await call('POST', '/api/catalog/reorder', { ids: reversed }, t.editor);
    expect(re.body.items.filter((i: any) => i.category === 'billing' && !i.parentId).map((i: any) => i.id)).toEqual(reversed);
  });

  it('edits duration rules, match words, auto-add and dependencies', async () => {
    const t = await setupTeam();
    const a = (await call('POST', '/api/catalog', { category: 'installation', name: 'Lay pavers', rule: { mode: 'per_qty', days: 1, perQty: 800, unit: 'sqft', minDays: 2 }, boqMatch: [' Paver ', 'paver', 'PAVER-60MM'] }, t.editor)).body.item;
    expect(a.rule).toEqual({ mode: 'per_qty', days: 1, perQty: 800, unit: 'sqft', minDays: 2 });
    expect(a.boqMatch).toEqual(['Paver', 'PAVER-60MM']);
    expect((await call('POST', '/api/catalog', { category: 'installation', name: 'Bad', rule: { mode: 'per_qty', days: 1, perQty: null, unit: null, minDays: 1 } }, t.editor)).status).toBe(400);

    const b = (await call('POST', '/api/catalog', { category: 'installation', name: 'Seal pavers', dependsOnId: a.id }, t.editor)).body.item;
    expect(b.dependsOnId).toBe(a.id);
    // A loop, a task waiting for a sub-task, and a sub-task waiting outside its task are refused.
    expect((await call('PATCH', `/api/catalog/${a.id}`, { dependsOnId: b.id }, t.editor)).status).toBe(400);
    expect((await call('PATCH', `/api/catalog/${a.id}`, { dependsOnId: a.id }, t.editor)).status).toBe(400);
    expect((await call('PATCH', `/api/catalog/${a.id}`, { dependsOnId: 'tl-m-turf-01' }, t.editor)).status).toBe(400);
    const s1 = (await call('POST', '/api/catalog', { category: 'installation', parentId: a.id, name: 'Compact sand bed' }, t.editor)).body.item;
    expect((await call('POST', '/api/catalog', { category: 'installation', parentId: a.id, name: 'Lay', dependsOnId: 'tl-m-turf-01' }, t.editor)).status).toBe(400);
    expect((await call('POST', '/api/catalog', { category: 'installation', parentId: a.id, name: 'Lay', dependsOnId: s1.id }, t.editor)).status).toBe(201);

    const patched = await call('PATCH', `/api/catalog/${a.id}`, { rule: fixed(3), boqMatch: ['paver'], autoAdd: true, dependsOnId: null }, t.editor);
    expect(patched.body.items.find((i: any) => i.id === a.id)).toMatchObject({ rule: fixed(3), boqMatch: ['paver'], autoAdd: true, dependsOnId: null });
    // Deleting a task frees what waited for it.
    await call('DELETE', `/api/catalog/${a.id}`, undefined, t.editor);
    expect((await call('GET', '/api/catalog', undefined, t.editor)).body.items.find((i: any) => i.id === b.id).dependsOnId).toBeNull();
  });

  it('deleting a task removes its sub-tasks; planner tasks keep their titles', async () => {
    const t = await setupTeam();
    const p = (await call('POST', '/api/projects', { name: 'P' }, t.editor)).body.project.id;
    const created = (await call('POST', '/api/tasks', { id: uuid(), projectId: p, title: 'Floodlights & poles', catalogItemId: 'tl-e-lights' }, t.editor)).body.tasks;
    expect(created.length).toBe(7);
    expect((await call('DELETE', '/api/catalog/tl-e-lights', undefined, t.editor)).status).toBe(200);
    const items = (await call('GET', '/api/catalog', undefined, t.editor)).body.items;
    expect(items.some((i: any) => i.id === 'tl-e-lights' || i.parentId === 'tl-e-lights')).toBe(false);
    const tasks = (await call('GET', '/api/plan', undefined, t.editor)).body.tasks.filter((x: any) => x.projectId === p);
    expect(tasks).toHaveLength(7);
    expect(tasks.every((x: any) => x.catalogItemId === null)).toBe(true);
    expect(tasks.find((x: any) => !x.parentId).title).toBe('Floodlights & poles');
  });
});
