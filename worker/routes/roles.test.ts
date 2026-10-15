import { describe, expect, it } from 'vitest';
import { call, setupTeam, uuid } from '../test/helpers';

/** CLAUDE.md rule 4: every write route is listed here; viewers get 403 on all of them. */
const WRITES: [string, string, unknown][] = [
  ['POST', '/api/projects', { name: 'X' }],
  ['POST', '/api/projects/reorder', { ids: ['x'] }],
  ['PATCH', '/api/projects/some-id', { name: 'Y' }],
  ['DELETE', '/api/projects/some-id', undefined],
  ['POST', '/api/tasks', { id: '00000000-0000-0000-0000-000000000000', projectId: 'p', title: 'T' }],
  ['POST', '/api/tasks/reorder', { projectId: 'p', parentId: null, ids: ['x'] }],
  ['PATCH', '/api/tasks/some-id', { title: 'T' }],
  ['POST', '/api/tasks/some-id/shift', { days: 1 }],
  ['DELETE', '/api/tasks/some-id', undefined],
  ['POST', '/api/catalog', { category: 'billing', name: 'X' }],
  ['POST', '/api/catalog/reorder', { ids: ['x'] }],
  ['PATCH', '/api/catalog/some-id', { name: 'X' }],
  ['DELETE', '/api/catalog/some-id', undefined],
  ['GET', '/api/links/boq-quotes', undefined],
  ['GET', '/api/links/crm-leads', undefined],
  ['GET', '/api/users', undefined],
  ['POST', '/api/users', { email: 'x@test.com', name: 'X', role: 'editor', temporaryPassword: 'temp12345' }],
];

describe('roles', () => {
  it('viewers can read the plan, Today and the catalogue', async () => {
    const t = await setupTeam();
    for (const path of ['/api/plan', '/api/plan/version', '/api/today', '/api/today?scope=mine&date=2026-10-15', '/api/catalog', '/api/auth/me']) {
      expect([path, (await call('GET', path, undefined, t.viewer)).status]).toEqual([path, 200]);
    }
  });

  it('viewers get 403 on every write route (and the picker sources)', async () => {
    const t = await setupTeam();
    for (const [method, path, body] of WRITES) {
      expect([method, path, (await call(method, path, body, t.viewer)).status]).toEqual([method, path, 403]);
    }
  });

  it('signed-out callers get 401', async () => {
    for (const [method, path, body] of WRITES) {
      expect([method, path, (await call(method, path, body)).status]).toEqual([method, path, 401]);
    }
    expect((await call('GET', '/api/plan')).status).toBe(401);
  });

  it('editors edit plans and the catalogue but not users, and cannot delete projects', async () => {
    const t = await setupTeam();
    const p = await call('POST', '/api/projects', { name: 'Editor project' }, t.editor);
    expect(p.status).toBe(201);
    expect((await call('POST', '/api/tasks', { id: uuid(), projectId: p.body.project.id, title: 'Raise PO', category: 'material' }, t.editor)).status).toBe(201);
    expect((await call('POST', '/api/catalog', { category: 'billing', name: 'Retention invoice' }, t.editor)).status).toBe(201);
    expect((await call('GET', '/api/users', undefined, t.editor)).status).toBe(403);
    expect((await call('DELETE', `/api/projects/${p.body.project.id}`, undefined, t.editor)).status).toBe(403);
    expect((await call('DELETE', `/api/projects/${p.body.project.id}`, undefined, t.admin)).status).toBe(200);
  });

  it('viewers cannot own tasks', async () => {
    const t = await setupTeam();
    const p = await call('POST', '/api/projects', { name: 'Ownership' }, t.admin);
    const res = await call('POST', '/api/tasks', { id: uuid(), projectId: p.body.project.id, title: 'X', assigneeId: t.ids.viewer }, t.admin);
    expect(res.status).toBe(400);
    expect((await call('POST', '/api/tasks', { id: uuid(), projectId: p.body.project.id, title: 'X', assigneeId: t.ids.editor }, t.admin)).status).toBe(201);
  });
});
