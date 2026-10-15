import { describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../index';
import { call, setupTeam } from '../test/helpers';

describe('project picker sources', () => {
  it('lists issued BOQ quotes (secret forwarded) and marks linked ones', async () => {
    const t = await setupTeam();
    const list = await call('GET', '/api/links/boq-quotes', undefined, t.editor);
    expect(list.status).toBe(200);
    expect(list.body.unavailable).toBeUndefined();
    expect(list.body.items.map((q: any) => q.displayNo)).toEqual(['KS/2026/0101 R1', 'KS/2026/0102']);
    const q = list.body.items[0];
    await call('POST', '/api/projects', { name: q.projectName, boqQuoteId: q.id, boqRootQuoteId: q.rootQuoteId, boqQuoteNo: q.displayNo, crmLeadId: q.crmLeadId }, t.editor);
    const again = await call('GET', '/api/links/boq-quotes?q=lake', undefined, t.editor);
    expect(again.body.items.map((x: any) => [x.id, !!x.linkedProjectId])).toEqual([['q-r1', true], ['q-2', false]]);
  });

  it('lists CRM leads: lost hidden, won first, linked marked', async () => {
    const t = await setupTeam();
    const list = await call('GET', '/api/links/crm-leads', undefined, t.editor);
    expect(list.body.items.map((l: any) => l.id)).toEqual(['lead1', 'lead2']);
    expect(list.body.items[0].linkedProjectId).not.toBeNull(); // linked through the BOQ quote above
    const withLost = await call('GET', '/api/links/crm-leads?lost=1', undefined, t.editor);
    expect(withLost.body.items.map((l: any) => l.id)).toEqual(['lead1', 'lead3', 'lead2']);
  });

  it('degrades to { items: [], unavailable } when a link is missing, failing or refusing', async () => {
    const t = await setupTeam();
    const req = (path: string, e: object) => app.request(`http://calendar.test${path}`, { headers: { cookie: t.editor } }, { ...env, ...e });
    const missing = await req('/api/links/boq-quotes', { BOQ: undefined });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ items: [], unavailable: 'The BOQ Maker link is not configured on this server' });
    const throwing = await req('/api/links/crm-leads', { CRM: { fetch: () => Promise.reject(new Error('boom')) } });
    expect(((await throwing.json()) as any).unavailable).toBe('Could not reach the CRM: boom');
    const refused = await req('/api/links/boq-quotes', { INTEGRATION_SECRET: 'wrong' });
    expect(((await refused.json()) as any).unavailable).toBe('BOQ Maker answered HTTP 403');
  });
});
