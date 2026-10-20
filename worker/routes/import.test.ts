import { describe, expect, it } from 'vitest';
import { defaultChoices } from '@shared/schedule/import';
import { call, setupTeam } from '../test/helpers';

// Drafting a project's Gantt from a BOQ quote: lines from the fake BOQ Maker (vitest.workers.config.ts).
async function linesOf(cookie: string, quoteId: string) {
  const res = await call('GET', `/api/links/boq-quotes/${quoteId}/lines`, undefined, cookie);
  expect(res.status).toBe(200);
  return res.body;
}
const catalog = async (cookie: string) => (await call('GET', '/api/catalog', undefined, cookie)).body.items as any[];
const projectTasks = async (cookie: string, projectId: string) =>
  ((await call('GET', '/api/plan', undefined, cookie)).body.tasks as any[]).filter((x) => x.projectId === projectId).sort((a, b) => a.sortOrder - b.sortOrder);

describe('quote lines link', () => {
  it('copies names, units and quantities — no prices — and degrades when BOQ cannot answer', async () => {
    const t = await setupTeam();
    const body = await linesOf(t.editor, 'q-r1');
    expect(body.quote).toMatchObject({ id: 'q-r1', rootQuoteId: 'q-root1', displayNo: 'KS/2026/0101 R1' });
    expect(body.lines.map((l: any) => [l.name, l.qty, l.unit, l.optional])).toEqual([
      ['Verde Arena', 6000, 'Sqft', false],
      ['Solaris 200F', 12, 'Nos', false],
      ['Site office cabin', 1, 'Lsm', false],
      ['Goal Pro Portable', 1, 'Pair', true],
    ]);
    expect(JSON.stringify(body)).not.toMatch(/rate|margin|amount|price/i);
    expect(await linesOf(t.editor, 'nope')).toEqual({ quote: null, lines: [], unavailable: 'BOQ Maker answered HTTP 404' });
  });
});

describe('import from a quote', () => {
  it('creates a project with one task per Task List entry, their sub-tasks, days and dependencies', async () => {
    const t = await setupTeam();
    const { lines } = await linesOf(t.editor, 'q-r1');
    const choices = defaultChoices(lines, await catalog(t.editor)).map((c) =>
      c.lineId === 'l3' ? { ...c, custom: { name: 'Site office cabin', category: 'logistics', rule: { mode: 'fixed', days: 2, perQty: null, unit: null, minDays: 1 }, saveToList: true } } : c,
    );
    expect(choices.find((c) => c.lineId === 'l1')!.templateIds).toEqual(['tl-m-turf', 'tl-i-turf']);
    expect(choices.find((c) => c.lineId === 'l4')!.include).toBe(false); // optional

    const res = await call(
      'POST',
      '/api/projects',
      {
        name: 'Clubhouse turf',
        boqQuoteId: 'q-r1',
        boqRootQuoteId: 'q-root1',
        boqQuoteNo: 'KS/2026/0101 R1',
        import: { quoteId: 'q-r1', quoteLabel: 'KS/2026/0101 R1', startDate: '2026-10-19', lines, choices, extraTemplateIds: ['tl-b-advance'] },
      },
      t.editor,
    );
    expect(res.status).toBe(201);
    const tasks = await projectTasks(t.editor, res.body.project.id);
    const top = tasks.filter((x) => !x.parentId);
    expect(top.map((x) => x.title)).toEqual(['Artificial turf', 'Floodlights & poles', 'Site office cabin', 'Turf installation', 'Floodlight installation', 'Advance invoice']);
    const turf = top[0];
    expect(turf).toMatchObject({ category: 'material', catalogItemId: 'tl-m-turf', quantities: { sqft: 6000 }, startDate: null });
    expect(turf.notes).toContain('Verde Arena — 6,000 sqft (Football)');
    const turfSteps = tasks.filter((x) => x.parentId === turf.id);
    expect(turfSteps.map((x) => x.plannedDays)).toEqual([1, 1, 1, 10, 7, 1]);
    expect(turfSteps.at(-1)).toMatchObject({ startDate: '2026-11-11', endDate: '2026-11-11' });

    const install = top.find((x) => x.title === 'Turf installation')!;
    expect(install.dependsOnId).toBe(turf.id);
    const firstInstallStep = tasks.filter((x) => x.parentId === install.id)[0];
    expect(firstInstallStep).toMatchObject({ title: 'Check base levels & clean', startDate: '2026-11-12' });
    expect(top.find((x) => x.title === 'Site office cabin')).toMatchObject({ plannedDays: 2, startDate: '2026-10-19', endDate: '2026-10-20' });

    // The one-off task was saved to the Task Lists with the line as its match: the next quote finds it.
    const cabin = (await catalog(t.editor)).find((i) => i.name === 'Site office cabin');
    expect(cabin).toMatchObject({ category: 'logistics', boqMatch: ['Site office cabin'], rule: { mode: 'fixed', days: 2 } });
    expect(defaultChoices(lines, await catalog(t.editor)).find((c) => c.lineId === 'l3')!.templateIds).toEqual([cabin.id]);
  });

  it('imports into an existing project, linking it, and remembers hand-picked matches', async () => {
    const t = await setupTeam();
    const blank = (await call('POST', '/api/projects', { name: 'Lake Park' }, t.editor)).body.project.id;
    const { lines } = await linesOf(t.editor, 'q-2');
    const choices = [{ lineId: 'l3', include: true, templateIds: ['tl-l-team'], remember: true }];
    const res = await call('POST', `/api/projects/${blank}/import`, { quoteId: 'q-2', rootQuoteId: 'q-2', quoteLabel: 'KS/2026/0102', startDate: '2026-10-19', lines, choices }, t.editor);
    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({ boqQuoteId: 'q-2', boqRootQuoteId: 'q-2', boqQuoteNo: 'KS/2026/0102' });
    expect((await projectTasks(t.editor, blank)).filter((x) => !x.parentId).map((x) => x.title)).toEqual(['Team travel & stay']);
    expect((await catalog(t.editor)).find((i) => i.id === 'tl-l-team').boqMatch).toContain('Site office cabin');

    // Linked to q-2 now: another quote family is refused; a family that already has a project too.
    expect((await call('POST', `/api/projects/${blank}/import`, { quoteId: 'q-r1', rootQuoteId: 'q-root1', startDate: '2026-10-19', lines, choices }, t.editor)).status).toBe(400);
    const other = (await call('POST', '/api/projects', { name: 'Another' }, t.editor)).body.project.id;
    expect((await call('POST', `/api/projects/${other}/import`, { quoteId: 'q-2', rootQuoteId: 'q-2', startDate: '2026-10-19', lines, choices }, t.editor)).status).toBe(409);
    // Lines read from an uploaded file add tasks without touching the quote link.
    const fileLines = [{ id: 'f1', name: 'Verde Arena', unit: 'Sqft', qty: 2000 }];
    const fromFile = await call('POST', `/api/projects/${blank}/import`, { source: 'file', quoteId: 'file', quoteLabel: 'Old BOQ.xlsx', startDate: '2026-10-19', lines: fileLines, choices: [{ lineId: 'f1', include: true, templateIds: ['tl-m-turf'] }] }, t.editor);
    expect(fromFile.status).toBe(201);
    expect(fromFile.body.project).toMatchObject({ boqQuoteId: 'q-2', boqQuoteNo: 'KS/2026/0102' });
    const turf = (await projectTasks(t.editor, blank)).find((x) => x.title === 'Artificial turf');
    expect(turf).toMatchObject({ quantities: { sqft: 2000 } });
    expect(turf.notes).toContain('From Old BOQ.xlsx:');
    // Everything skipped: nothing to add.
    expect((await call('POST', `/api/projects/${blank}/import`, { quoteId: 'q-2', rootQuoteId: 'q-2', startDate: '2026-10-19', lines, choices: [{ lineId: 'l1', include: false, templateIds: [] }] }, t.editor)).status).toBe(400);
  });
});
