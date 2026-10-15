import { describe, expect, it } from 'vitest';
import { call, setupTeam, uuid } from '../test/helpers';

describe('catalogue', () => {
  it('ships the starter catalogue in four categories', async () => {
    const t = await setupTeam();
    const items = (await call('GET', '/api/catalog', undefined, t.viewer)).body.items as any[];
    const templates = items.filter((i) => !i.parentId);
    expect(new Set(templates.map((i) => i.category))).toEqual(new Set(['material', 'equipment', 'logistics', 'billing']));
    expect(templates.length).toBe(16);
    expect(items.filter((i) => i.parentId === 'cat-material-01').map((i) => i.name)[0]).toBe('Confirm specs & quantities from BOQ');
  });

  it('adds, renames, reorders and refuses duplicates', async () => {
    const t = await setupTeam();
    const add = await call('POST', '/api/catalog', { category: 'billing', name: 'Retention release invoice' }, t.editor);
    expect(add.status).toBe(201);
    const id = add.body.item.id;
    expect((await call('POST', '/api/catalog', { category: 'billing', name: 'retention RELEASE invoice' }, t.editor)).status).toBe(409);
    // Same name is fine in another category.
    expect((await call('POST', '/api/catalog', { category: 'logistics', name: 'Retention release invoice' }, t.editor)).status).toBe(201);
    const step = await call('POST', '/api/catalog', { category: 'material', parentId: id, name: 'Raise invoice' }, t.editor);
    expect(step.body.item).toMatchObject({ category: 'billing', parentId: id }); // follows its template
    expect((await call('POST', '/api/catalog', { category: 'billing', parentId: step.body.item.id, name: 'Too deep' }, t.editor)).status).toBe(400);
    const renamed = await call('PATCH', `/api/catalog/${id}`, { name: 'Retention invoice' }, t.editor);
    expect(renamed.body.items.find((i: any) => i.id === id).name).toBe('Retention invoice');

    const billing = (await call('GET', '/api/catalog', undefined, t.editor)).body.items.filter((i: any) => i.category === 'billing' && !i.parentId);
    const reversed = billing.map((i: any) => i.id).reverse();
    const re = await call('POST', '/api/catalog/reorder', { ids: reversed }, t.editor);
    expect(re.body.items.filter((i: any) => i.category === 'billing' && !i.parentId).map((i: any) => i.id)).toEqual(reversed);
  });

  it('deleting a template removes its steps; tasks keep their titles', async () => {
    const t = await setupTeam();
    const p = (await call('POST', '/api/projects', { name: 'P' }, t.editor)).body.project.id;
    const created = (await call('POST', '/api/tasks', { id: uuid(), projectId: p, title: 'Floodlights & poles', catalogItemId: 'cat-equipment-02' }, t.editor)).body.tasks;
    expect(created.length).toBe(5);
    expect((await call('DELETE', '/api/catalog/cat-equipment-02', undefined, t.editor)).status).toBe(200);
    const items = (await call('GET', '/api/catalog', undefined, t.editor)).body.items;
    expect(items.some((i: any) => i.id === 'cat-equipment-02' || i.parentId === 'cat-equipment-02')).toBe(false);
    const tasks = (await call('GET', '/api/plan', undefined, t.editor)).body.tasks.filter((x: any) => x.projectId === p);
    expect(tasks).toHaveLength(5);
    expect(tasks.every((x: any) => x.catalogItemId === null)).toBe(true);
    expect(tasks.find((x: any) => !x.parentId).title).toBe('Floodlights & poles');
  });
});
