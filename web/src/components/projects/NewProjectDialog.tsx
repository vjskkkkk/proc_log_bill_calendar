import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BoqQuoteSummary, CreateProjectInput, CrmLeadSummary } from '@shared/schemas/plan';
import { formatShort, istDateOf } from '@shared/schedule/dates';
import { crmTitle } from '@shared/crm';
import { useBoqQuotes, useCrmLeads } from '../../api/links';
import { useCreateProject } from '../../api/plan';
import { ErrorText, Field } from '../Field';
import { Modal, Seg } from '../ui';
import { toast } from '../../lib/toast';
import { BoqFilePicker, QuoteImportReview, toImportInput, useFileDraft, useQuoteDraft } from './QuoteImport';

type Source = 'boq' | 'file' | 'crm' | 'blank';

interface Draft {
  name: string;
  client: string;
  location: string;
  notes: string;
  boqQuoteId: string | null;
  boqRootQuoteId: string | null;
  boqQuoteNo: string;
  crmLeadId: string | null;
  sourceLabel: string;
}

const EMPTY: Draft = { name: '', client: '', location: '', notes: '', boqQuoteId: null, boqRootQuoteId: null, boqQuoteNo: '', crmLeadId: null, sourceLabel: '' };

const QUOTE_STATUS: Record<string, string> = { pdf_issued: 'Issued', sent: 'Sent', won: 'Won' };

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function Unavailable({ reason }: { reason: string }) {
  return (
    <div className="rounded-lg border border-brand-yellow/60 bg-brand-yellow/15 p-3 text-sm text-warn-fg">
      <b>Can't reach it right now.</b> {reason}. Use <b>Blank</b>, or try again later.
    </div>
  );
}

function fromQuote(q: BoqQuoteSummary): Draft {
  return {
    name: crmTitle(q.clientCompany, q.projectName) || q.displayNo,
    client: q.clientCompany || q.clientName,
    location: q.location,
    notes: q.clientName && q.clientCompany ? `Client contact: ${q.clientName}` : '',
    boqQuoteId: q.id,
    boqRootQuoteId: q.rootQuoteId,
    boqQuoteNo: q.displayNo,
    crmLeadId: q.crmLeadId,
    sourceLabel: `BOQ quote ${q.displayNo}`,
  };
}

function fromLead(l: CrmLeadSummary): Draft {
  return {
    ...EMPTY,
    name: l.company,
    client: l.company,
    notes: l.contact ? `Contact: ${l.contact}` : '',
    crmLeadId: l.id,
    sourceLabel: `CRM lead: ${l.company}`,
  };
}

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [source, setSource] = useState<Source>('boq');
  const [q, setQ] = useState('');
  const [lost, setLost] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const dq = useDebounced(q, 250);
  const quotes = useBoqQuotes(dq, source === 'boq' && !draft);
  const leads = useCrmLeads(source === 'crm' && !draft, lost);
  const create = useCreateProject();
  const nav = useNavigate();
  // Picking a quote also drafts the project's Gantt from its lines (docs/PLAN.md "Import from a quote").
  const [drafting, setDrafting] = useState(true);
  const quoteDraft = useQuoteDraft(draft?.boqQuoteId ?? null);
  const lineData = quoteDraft.lines.data;
  const canDraft = !!draft?.boqQuoteId && !!lineData && !lineData.unavailable && !!quoteDraft.draft && !!quoteDraft.catalog.data;
  // From a file: its lines (editable) drive the same review.
  const fileDraft = useFileDraft();
  const fromFile = source === 'file' && !!fileDraft.file;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const input: CreateProjectInput = {
      name: draft.name,
      client: draft.client,
      location: draft.location,
      notes: draft.notes,
      boqQuoteId: draft.boqQuoteId,
      boqRootQuoteId: draft.boqRootQuoteId,
      boqQuoteNo: draft.boqQuoteNo,
      crmLeadId: draft.crmLeadId,
      ...(drafting && canDraft
        ? { import: toImportInput(quoteDraft.draft!, { id: draft.boqQuoteId!, rootQuoteId: draft.boqRootQuoteId ?? draft.boqQuoteId!, displayNo: draft.boqQuoteNo }, lineData!.lines) }
        : {}),
      ...(fromFile && drafting && fileDraft.draft && fileDraft.lines
        ? {
            import: toImportInput(
              fileDraft.draft,
              { id: 'file', rootQuoteId: 'file', displayNo: fileDraft.file!.name },
              fileDraft.lines.filter((l) => l.name.trim()),
              'file',
            ),
          }
        : {}),
    };
    create.mutate(input, {
      onSuccess: ({ project }) => {
        toast(input.import ? `Project "${project.name}" created with its tasks from the quote` : `Project "${project.name}" created — add its tasks`, { tone: 'ok' });
        onClose();
        nav(`/planner?focus=project:${project.id}`);
      },
    });
  };

  const crmLeadsFiltered = (leads.data?.items ?? []).filter((l) => !q || `${l.company} ${l.contact} ${l.product}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <Modal
      title="New project"
      onClose={onClose}
      wide
      footer={
        draft ? (
          <>
            <button type="button" className="btn-secondary" onClick={() => setDraft(null)}>
              Back
            </button>
            <button type="submit" form="new-project" className="btn-primary" disabled={create.isPending || !draft.name.trim()}>
              {create.isPending ? 'Creating…' : drafting && (canDraft || (fromFile && fileDraft.draft)) ? 'Create project with tasks' : 'Create project'}
            </button>
          </>
        ) : undefined
      }
    >
      {!draft && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Seg
              label="Start from"
              value={source}
              onChange={(s) => {
                setSource(s);
                if (s === 'blank') setDraft({ ...EMPTY });
              }}
              options={[
                { value: 'boq', label: 'From a BOQ quote' },
                { value: 'file', label: 'From a file' },
                { value: 'crm', label: 'From a CRM lead' },
                { value: 'blank', label: 'Blank' },
              ]}
            />
            {source !== 'file' && (
              <input className="input min-h-9 flex-1 py-1" placeholder={source === 'boq' ? 'Search quote no., client, project, location…' : 'Search company, contact…'} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
            )}
          </div>

          {source === 'boq' && (
            <>
              {quotes.data?.unavailable && <Unavailable reason={quotes.data.unavailable} />}
              {quotes.isLoading && <p className="text-sm text-muted">Asking BOQ Maker…</p>}
              {quotes.isError && <ErrorText error={quotes.error} />}
              {quotes.data && !quotes.data.unavailable && !quotes.data.items.length && <p className="text-sm text-muted">No issued quotes{q ? ' match' : ' yet'}.</p>}
              <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
                {quotes.data?.items.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      disabled={!!x.linkedProjectId}
                      onClick={() => setDraft(fromQuote(x))}
                      className="grid w-full grid-cols-[11rem_1fr_10rem_6rem] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="font-mono text-xs">{x.displayNo}</span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{crmTitle(x.clientCompany, x.projectName) || '—'}</span>
                        <span className="block truncate text-xs text-muted">{x.location || 'No location'}</span>
                      </span>
                      <span className="text-xs text-muted">{x.linkedProjectId ? 'Already a project' : x.pdfIssuedAt ? `Issued ${formatShort(istDateOf(x.pdfIssuedAt))}` : ''}</span>
                      <span className={`chip justify-self-end ${x.status === 'won' ? 'bg-brand-green/20 text-ok' : 'bg-brand-yellow/30 text-warn-fg'}`}>{QUOTE_STATUS[x.status] ?? x.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {source === 'file' && (
            <BoqFilePicker
              onRead={(name, read) => {
                fileDraft.load(name, read);
                setDraft({ ...EMPTY, name: read.title, notes: `Drafted from ${name}`, sourceLabel: `file ${name}` });
              }}
            />
          )}

          {source === 'crm' && (
            <>
              {leads.data?.unavailable && <Unavailable reason={leads.data.unavailable} />}
              {leads.isLoading && <p className="text-sm text-muted">Asking the CRM…</p>}
              {leads.isError && <ErrorText error={leads.error} />}
              <label className="inline-flex items-center gap-2 text-sm text-muted-strong">
                <input type="checkbox" className="accent-brand-purple" checked={lost} onChange={(e) => setLost(e.target.checked)} /> Show lost leads
              </label>
              <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
                {crmLeadsFiltered.map((l) => (
                  <li key={l.id}>
                    <button
                      type="button"
                      disabled={!!l.linkedProjectId}
                      onClick={() => setDraft(fromLead(l))}
                      className="grid w-full grid-cols-[1fr_12rem_9rem_6rem] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <span className="truncate font-medium">{l.company || '—'}</span>
                      <span className="truncate text-xs text-muted">{l.contact}</span>
                      <span className="truncate text-xs text-muted">{l.linkedProjectId ? 'Already a project' : l.product}</span>
                      <span className={`chip justify-self-end ${l.outcome === 'won' ? 'bg-brand-green/20 text-ok' : l.outcome === 'lost' ? 'bg-brand-red/15 text-brand-red' : 'bg-surface-3 text-muted-strong'}`}>
                        {l.outcome === 'won' ? 'Won' : l.outcome === 'lost' ? 'Lost' : `Stage ${l.stage}`}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {draft && (
        <form id="new-project" onSubmit={submit} className="grid grid-cols-2 gap-3">
          {draft.sourceLabel && (
            <div className="col-span-2 rounded-lg bg-brand-purple/10 px-3 py-2 text-sm text-brand-purple">
              Linked to <b>{draft.sourceLabel}</b>. These details are copied now; edit them freely.
            </div>
          )}
          <div className="col-span-2">
            <Field label="Project name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required autoFocus maxLength={200} />
          </div>
          <Field label="Client" value={draft.client} onChange={(e) => setDraft({ ...draft, client: e.target.value })} maxLength={200} />
          <Field label="Site / location" value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} maxLength={200} />
          <label className="col-span-2 block">
            <span className="label">Notes</span>
            <textarea className="input min-h-20" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} maxLength={5000} />
          </label>
          {fromFile && (
            <div className="col-span-2 border-t border-line pt-3">
              <label className="mb-2 flex items-center gap-2 font-medium">
                <input type="checkbox" className="h-4 w-4 accent-brand-purple" checked={drafting} onChange={(e) => setDrafting(e.target.checked)} />
                Draft the planner from this file's line items ({fileDraft.file!.read.lines.length} read; check them below)
              </label>
              {drafting && fileDraft.draft && fileDraft.lines && fileDraft.catalog.data && (
                <QuoteImportReview
                  lines={fileDraft.lines}
                  onLinesChange={fileDraft.setLines}
                  catalog={fileDraft.catalog.data}
                  draft={fileDraft.draft}
                  onChange={fileDraft.setDraft}
                  quoteLabel={fileDraft.file!.name}
                />
              )}
            </div>
          )}
          {draft.boqQuoteId && (
            <div className="col-span-2 border-t border-line pt-3">
              <label className="mb-2 flex items-center gap-2 font-medium">
                <input type="checkbox" className="h-4 w-4 accent-brand-purple" checked={drafting} onChange={(e) => setDrafting(e.target.checked)} />
                Draft the planner from this quote's line items
              </label>
              {drafting && (quoteDraft.lines.isLoading || quoteDraft.catalog.isLoading) && <p className="text-sm text-muted">Reading the quote's line items…</p>}
              {drafting && lineData?.unavailable && (
                <div className="rounded-lg border border-brand-yellow/60 bg-brand-yellow/15 p-3 text-sm text-warn-fg">
                  <b>Can't read the quote's line items right now.</b> {lineData.unavailable}. The project can still be created; add its tasks later with{' '}
                  <b>⇣ From quote</b> on its planner row.
                </div>
              )}
              {drafting && canDraft && (
                <QuoteImportReview lines={lineData!.lines} catalog={quoteDraft.catalog.data!} draft={quoteDraft.draft!} onChange={quoteDraft.setDraft} quoteLabel={draft.boqQuoteNo} />
              )}
            </div>
          )}
          <div className="col-span-2">
            <ErrorText error={create.error} />
          </div>
        </form>
      )}
    </Modal>
  );
}
