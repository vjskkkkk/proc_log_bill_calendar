import { describe, expect, it } from 'vitest';
import { call, setupTeam, uuid } from '../test/helpers';

describe('projects', () => {
  it('creates blank and linked projects; one project per quote family and per lead', async () => {
    const t = await setupTeam();
    const blank = await call('POST', '/api/projects', { name: '  Site A  ', client: 'Client' }, t.editor);
    expect(blank.status).toBe(201);
    expect(blank.body.project).toMatchObject({ name: 'Site A', status: 'active', boqQuoteId: null, crmLeadId: null });

    const linked = await call('POST', '/api/projects', { name: 'Clubhouse', boqQuoteId: 'q-r1', boqRootQuoteId: 'q-root1', boqQuoteNo: 'KS/2026/0101 R1', crmLeadId: 'lead1' }, t.editor);
    expect(linked.status).toBe(201);
    const again = await call('POST', '/api/projects', { name: 'Again', boqQuoteId: 'q-r2', boqRootQuoteId: 'q-root1' }, t.editor);
    expect(again.status).toBe(409);
    expect(again.body.projectId).toBe(linked.body.project.id);
    expect((await call('POST', '/api/projects', { name: 'Lead again', crmLeadId: 'lead1' }, t.editor)).status).toBe(409);
    expect((await call('POST', '/api/projects', { name: '' }, t.editor)).status).toBe(400);
  });

  it('edits status; the plan hides archived projects unless asked', async () => {
    const t = await setupTeam();
    const p = (await call('POST', '/api/projects', { name: 'To archive' }, t.editor)).body.project.id;
    expect((await call('PATCH', `/api/projects/${p}`, { status: 'archived' }, t.editor)).body.project.status).toBe('archived');
    expect((await call('PATCH', `/api/projects/${p}`, { status: 'bogus' }, t.editor)).status).toBe(400);
    const def = (await call('GET', '/api/plan', undefined, t.viewer)).body;
    expect(def.projects.some((x: any) => x.id === p)).toBe(false);
    const all = (await call('GET', '/api/plan?statuses=active,on_hold,completed,archived', undefined, t.viewer)).body;
    expect(all.projects.some((x: any) => x.id === p)).toBe(true);
  });

  it('deleting a project (admin) removes its tasks', async () => {
    const t = await setupTeam();
    const p = (await call('POST', '/api/projects', { name: 'Doomed' }, t.editor)).body.project.id;
    const task = uuid();
    await call('POST', '/api/tasks', { id: task, projectId: p, title: 'T' }, t.editor);
    await call('POST', '/api/tasks', { id: uuid(), projectId: p, parentId: task, title: 'S' }, t.editor);
    expect((await call('DELETE', `/api/projects/${p}`, undefined, t.admin)).status).toBe(200);
    const pl = (await call('GET', '/api/plan?statuses=active,on_hold,completed,archived', undefined, t.admin)).body;
    expect(pl.tasks.some((x: any) => x.projectId === p)).toBe(false);
    expect((await call('PATCH', `/api/tasks/${task}`, { title: 'gone' }, t.editor)).status).toBe(404);
  });

  it('reorders projects', async () => {
    const t = await setupTeam();
    const pl = (await call('GET', '/api/plan?statuses=active,on_hold,completed,archived', undefined, t.admin)).body;
    const ids = pl.projects.map((x: any) => x.id).reverse();
    expect((await call('POST', '/api/projects/reorder', { ids }, t.editor)).status).toBe(200);
    const after = (await call('GET', '/api/plan?statuses=active,on_hold,completed,archived', undefined, t.admin)).body;
    expect(after.projects.map((x: any) => x.id)).toEqual(ids);
  });
});
