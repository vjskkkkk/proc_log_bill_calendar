/**
 * The project picker's sources (docs/PLAN.md "BOQ Maker change"): issued quotes from BOQ Maker and leads from the CRM,
 * read over service bindings with the shared INTEGRATION_SECRET. Never throws: when the other app cannot be asked the
 * answer is `{ items: [], unavailable }` and the dialog's other tabs keep working (CLAUDE.md rule 5).
 */
import { isNotNull } from 'drizzle-orm';
import type { BoqQuoteSummary, CrmLeadSummary, LinkList } from '@shared/schemas/plan';
import { schema, type Db } from '../db/client';
import type { Env } from '../env';

export const INTEGRATION_HEADER = 'X-Integration-Secret';
const TIMEOUT_MS = 5000;

type Fetched = { ok: true; body: unknown } | { ok: false; reason: string };

async function ask(binding: Fetcher | undefined, secret: string | undefined, url: string, app: string): Promise<Fetched> {
  if (!binding || !secret) return { ok: false, reason: `The ${app} link is not configured on this server` };
  let res: Response;
  try {
    res = await binding.fetch(url, { headers: { [INTEGRATION_HEADER]: secret }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    return { ok: false, reason: `Could not reach ${app}: ${(e as Error).message}` };
  }
  if (!res.ok) return { ok: false, reason: `${app} answered HTTP ${res.status}` };
  try {
    return { ok: true, body: await res.json() };
  } catch {
    return { ok: false, reason: `${app} sent an unreadable answer` };
  }
}

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const sOrNull = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

async function linkedBy(d: Db, field: 'boqRootQuoteId' | 'crmLeadId'): Promise<Map<string, string>> {
  const rows = await d.select({ id: schema.projects.id, key: schema.projects[field] }).from(schema.projects).where(isNotNull(schema.projects[field]));
  return new Map(rows.map((r) => [r.key!, r.id]));
}

export async function boqQuotes(env: Env, d: Db, q: string): Promise<LinkList<BoqQuoteSummary>> {
  const url = `https://boq/api/integration/planner/quotes?q=${encodeURIComponent(q)}`;
  const got = await ask(env.BOQ, env.INTEGRATION_SECRET, url, 'BOQ Maker');
  if (!got.ok) return { items: [], unavailable: got.reason };
  const raw = (got.body as { quotes?: unknown[] })?.quotes;
  if (!Array.isArray(raw)) return { items: [], unavailable: 'BOQ Maker sent an unexpected answer' };
  const linked = await linkedBy(d, 'boqRootQuoteId');
  const items = raw.map((x): BoqQuoteSummary => {
    const r = x as Record<string, unknown>;
    const rootQuoteId = s(r.rootQuoteId) || s(r.id);
    return {
      id: s(r.id),
      rootQuoteId,
      quoteNo: s(r.quoteNo),
      displayNo: s(r.displayNo) || s(r.quoteNo),
      revision: Number(r.revision) || 0,
      status: s(r.status),
      quoteType: s(r.quoteType),
      clientCompany: s(r.clientCompany),
      clientName: s(r.clientName),
      projectName: s(r.projectName),
      location: s(r.location),
      crmLeadId: sOrNull(r.crmLeadId),
      pdfIssuedAt: sOrNull(r.pdfIssuedAt),
      linkedProjectId: linked.get(rootQuoteId) ?? null,
    };
  });
  return { items: items.filter((i) => i.id) };
}

/** Open and won leads (lost ones hidden unless asked): won first, then by stage, furthest along first. */
export async function crmLeads(env: Env, d: Db, includeLost = false): Promise<LinkList<CrmLeadSummary>> {
  const got = await ask(env.CRM, env.INTEGRATION_SECRET, 'https://crm/api/integration/leads', 'the CRM');
  if (!got.ok) return { items: [], unavailable: got.reason };
  const raw = (got.body as { leads?: unknown[] })?.leads;
  if (!Array.isArray(raw)) return { items: [], unavailable: 'The CRM sent an unexpected answer' };
  const linked = await linkedBy(d, 'crmLeadId');
  const items = raw
    .map((x): CrmLeadSummary => {
      const r = x as Record<string, unknown>;
      return {
        id: s(r.id),
        company: s(r.company),
        contact: s(r.contact),
        product: s(r.product),
        stage: Number(r.stage) || 0,
        outcome: s(r.outcome).toLowerCase(),
        linkedProjectId: linked.get(s(r.id)) ?? null,
      };
    })
    .filter((l) => l.id && (includeLost || l.outcome !== 'lost'));
  const rank = (l: CrmLeadSummary) => (l.outcome === 'won' ? 1000 : 0) + l.stage;
  items.sort((a, b) => rank(b) - rank(a) || a.company.localeCompare(b.company));
  return { items };
}
