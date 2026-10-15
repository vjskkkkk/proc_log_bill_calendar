import { describe, expect, it } from 'vitest';
import { todayIST, addDays } from '@shared/schedule/dates';
import { call, setupTeam, uuid } from '../test/helpers';

describe('plan and today', () => {
  it('returns projects, tasks and people without emails or password hashes', async () => {
    const t = await setupTeam();
    const pl = await call('GET', '/api/plan', undefined, t.viewer);
    expect(pl.status).toBe(200);
    expect(Object.keys(pl.body).sort()).toEqual(['people', 'projects', 'tasks', 'today', 'version']);
    expect(pl.body.people.map((p: any) => Object.keys(p).sort())[0]).toEqual(['active', 'id', 'name', 'role']);
    const text = JSON.stringify(pl.body);
    expect(text).not.toMatch(/@test\.com|pbkdf2|password/i);
    expect(pl.body.today).toBe(todayIST());
  });

  it('GET /api/today lists active + overdue items, Mine or All', async () => {
    const t = await setupTeam();
    const today = todayIST();
    const p = (await call('POST', '/api/projects', { name: 'Today project' }, t.editor)).body.project.id;
    await call('POST', '/api/tasks', { id: uuid(), projectId: p, title: 'Mine now', startDate: today, endDate: addDays(today, 2), assigneeId: t.ids.editor }, t.editor);
    await call('POST', '/api/tasks', { id: uuid(), projectId: p, title: 'Late', startDate: addDays(today, -5), endDate: addDays(today, -2), assigneeId: t.ids.admin }, t.editor);
    await call('POST', '/api/tasks', { id: uuid(), projectId: p, title: 'Later', startDate: addDays(today, 3), endDate: addDays(today, 4) }, t.editor);

    const all = (await call('GET', '/api/today', undefined, t.editor)).body;
    const titles = all.projects.flatMap((x: any) => x.groups.flatMap((g: any) => g.items.map((i: any) => `${i.task.title}:${i.kind}`)));
    expect(titles).toEqual(['Mine now:active', 'Late:overdue']);
    const mine = (await call('GET', '/api/today?scope=mine', undefined, t.editor)).body;
    expect(mine.projects.flatMap((x: any) => x.groups.flatMap((g: any) => g.items.map((i: any) => i.task.title)))).toEqual(['Mine now']);
    expect((await call('GET', '/api/today?date=2026-13-01', undefined, t.editor)).status).toBe(400);
  });
});
