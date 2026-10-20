import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT, type Category } from '@shared/categories';
import { FIXED_ONE_DAY, type CatalogItemDto, type ImportQuoteInput, type ProjectDto } from '@shared/schemas/plan';
import { formatShort, formatMedium, todayIST, type IsoDate } from '@shared/schedule/dates';
import { buildImportPlan, defaultChoices, matchLine, type LineChoice, type QuoteLine } from '@shared/schedule/import';
import { addQuantity, describeQuantities, normaliseUnit, type DurationRule } from '@shared/schedule/rules';
import { rollForward, workingDays } from '@shared/schedule/workdays';
import { crmTitle } from '@shared/crm';
import { useCatalog } from '../../api/catalog';
import { useBoqQuotes, useQuoteLines } from '../../api/links';
import { errorText, useImportQuote } from '../../api/plan';
import { ACCEPTED_FILES, readBoqFile, type ReadFile } from '../../lib/readBoqFile';
import { toast } from '../../lib/toast';
import { RuleEditor } from '../RuleEditor';
import { CategoryDot, Modal } from '../ui';

/** A line's choice in the review, plus the browser-only bits (new-task form, remember). */
export interface DraftChoice extends LineChoice {
  custom: { name: string; category: Category; rule: DurationRule; saveToList: boolean } | null;
  remember: boolean;
}

export interface ImportDraft {
  startDate: IsoDate;
  choices: DraftChoice[];
  extraTemplateIds: string[];
}

/** BOQ category → the planner category a new task for an unmatched line most likely belongs to. */
function guessCategory(line: QuoteLine): Category {
  const c = `${line.category} ${line.subCategory}`.toLowerCase();
  if (c.includes('equipment') || c.includes('light') || c.includes('padel')) return 'equipment';
  if (c.includes('civil')) return 'installation';
  return 'material';
}

export function newDraft(lines: QuoteLine[], catalog: CatalogItemDto[]): ImportDraft {
  return {
    startDate: rollForward(todayIST()),
    choices: defaultChoices(lines, catalog).map((c) => ({ ...c, custom: null, remember: false })),
    extraTemplateIds: catalog.filter((i) => !i.parentId && i.autoAdd).map((i) => i.id),
  };
}

export function toImportInput(draft: ImportDraft, quote: { id: string; rootQuoteId: string; displayNo: string }, lines: QuoteLine[], source: 'boq' | 'file' = 'boq'): ImportQuoteInput {
  return {
    source,
    quoteId: quote.id,
    rootQuoteId: quote.rootQuoteId,
    quoteLabel: quote.displayNo,
    startDate: draft.startDate,
    lines,
    choices: draft.choices.map((c) => ({ lineId: c.lineId, include: c.include, templateIds: c.templateIds, custom: c.custom, remember: c.remember })),
    extraTemplateIds: draft.extraTemplateIds,
  };
}

const qtyText = (l: QuoteLine) => describeQuantities(addQuantity({}, normaliseUnit(l.unit), l.qty)) || `${l.qty} ${l.unit}`;

function TemplatePicker({ catalog, exclude, onPick, label }: { catalog: CatalogItemDto[]; exclude: string[]; onPick: (id: string) => void; label: string }) {
  return (
    <select className="input min-h-7 w-36 cursor-pointer px-1.5 py-0 text-xs text-brand-purple" value="" onChange={(e) => e.target.value && onPick(e.target.value)} aria-label={label}>
      <option value="">{label}</option>
      {CATEGORIES.map((c) => (
        <optgroup key={c} label={CATEGORY_LABEL[c]}>
          {catalog
            .filter((i) => !i.parentId && i.category === c && !exclude.includes(i.id))
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/** The review: what each quote line becomes, what is always added, when it starts, and the resulting tasks. */
export function QuoteImportReview({
  lines,
  catalog,
  draft,
  onChange,
  quoteLabel,
  onLinesChange,
}: {
  lines: QuoteLine[];
  catalog: CatalogItemDto[];
  draft: ImportDraft;
  onChange: (d: ImportDraft) => void;
  quoteLabel: string;
  /** Lines read from a file can be corrected, added and removed here. */
  onLinesChange?: (lines: QuoteLine[]) => void;
}) {
  const byId = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const setChoice = (lineId: string, patch: Partial<DraftChoice>) => onChange({ ...draft, choices: draft.choices.map((c) => (c.lineId === lineId ? { ...c, ...patch } : c)) });
  const editLine = (id: string, patch: Partial<QuoteLine>) => {
    const next = lines.map((l) => (l.id === id ? { ...l, ...patch } : l));
    onLinesChange?.(next);
    // A new name is matched again (what the Task Lists say it brings in).
    if (patch.name !== undefined) setChoice(id, { templateIds: matchLine(next.find((l) => l.id === id)!, catalog) });
  };
  const addLine = () => {
    const id = `new-${Date.now().toString(36)}`;
    onLinesChange?.([...lines, { id, area: '', sport: '', code: '', name: '', unit: 'Sqft', qty: 0, optional: false, category: '', subCategory: '' }]);
    onChange({ ...draft, choices: [...draft.choices, { lineId: id, include: true, templateIds: [], custom: null, remember: false }] });
  };
  const defaults = useMemo(() => new Map(defaultChoices(lines, catalog).map((c) => [c.lineId, c.templateIds])), [lines, catalog]);

  const plan = useMemo(
    () =>
      buildImportPlan({
        lines,
        choices: draft.choices.map((c) => ({ ...c, custom: c.custom ? { name: c.custom.name, category: c.custom.category, rule: c.custom.rule } : null })),
        items: catalog,
        extraTemplateIds: draft.extraTemplateIds,
        startDate: draft.startDate,
        quoteLabel,
      }),
    [lines, draft, catalog, quoteLabel],
  );
  const top = plan.filter((p) => !p.parentKey);
  const spanOf = (key: string) => {
    const mine = plan.filter((p) => (p.key === key || p.parentKey === key) && p.startDate);
    if (!mine.length) return null;
    return { start: mine.reduce((a, p) => (p.startDate! < a ? p.startDate! : a), mine[0]!.startDate!), end: mine.reduce((a, p) => (p.endDate! > a ? p.endDate! : a), mine[0]!.endDate!) };
  };
  const all = plan.filter((p) => p.startDate);
  const finish = all.length ? all.reduce((a, p) => (p.endDate! > a ? p.endDate! : a), all[0]!.endDate!) : null;
  const unmatched = draft.choices.filter((c) => c.include && !c.templateIds.length && !c.custom).length;
  const autoAdd = catalog.filter((i) => !i.parentId && i.autoAdd).sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="font-medium">Work starts</span>
          <input type="date" className="input min-h-8 w-40 py-0.5" value={draft.startDate} onChange={(e) => e.target.value && onChange({ ...draft, startDate: e.target.value })} />
        </label>
        <span className="text-muted">
          Independent tasks start then; the rest follow what they wait for. Sundays are skipped.
          {finish && (
            <>
              {' '}
              Last item ends <b className="text-fg">{formatMedium(finish)}</b> ({workingDays(rollForward(draft.startDate), finish)} working days).
            </>
          )}
        </span>
      </div>

      <section>
        <h3 className="mb-1 font-semibold">
          Quote lines <span className="font-normal text-muted">· {lines.length}</span>
          {unmatched > 0 && <span className="ml-2 chip bg-brand-yellow/30 text-warn-fg">{unmatched} not matched — pick a task, add a new one, or untick</span>}
        </h3>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left">
            <thead className="bg-surface-2 col-head">
              <tr>
                <th className="w-8 px-2 py-1.5" title="Use this line">Use</th>
                <th className="px-2 py-1.5">Line</th>
                <th className="w-28 px-2 py-1.5 text-right">Quantity</th>
                <th className="px-2 py-1.5">Becomes (Task Lists)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => {
                const c = draft.choices.find((x) => x.lineId === l.id)!;
                const handPicked = c.templateIds.some((id) => !(defaults.get(l.id) ?? []).includes(id));
                return (
                  <tr key={l.id} className={`align-top ${c.include ? '' : 'opacity-50'}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-purple" checked={c.include} onChange={(e) => setChoice(l.id, { include: e.target.checked })} aria-label={`Use ${l.name}`} />
                    </td>
                    <td className="px-2 py-1.5">
                      {onLinesChange ? (
                        <input
                          className="input min-h-7 py-0 text-sm font-medium"
                          value={l.name}
                          placeholder="Item name"
                          onChange={(e) => editLine(l.id, { name: e.target.value })}
                          aria-label="Item name"
                          maxLength={500}
                        />
                      ) : (
                        <div className="font-medium">{l.name}</div>
                      )}
                      <div className="text-xs text-muted">
                        {[l.area, l.category, l.code].filter(Boolean).join(', ')}
                        {l.optional && <span className="ml-1 chip bg-surface-3 text-muted-strong">Optional</span>}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {onLinesChange ? (
                        <span className="flex justify-end gap-1">
                          <input
                            className="input min-h-7 w-20 px-1.5 py-0 text-right text-sm"
                            inputMode="decimal"
                            value={l.qty || ''}
                            onChange={(e) => {
                              const n = Number(e.target.value.replace(/,/g, ''));
                              if (Number.isFinite(n) && n >= 0) editLine(l.id, { qty: n });
                            }}
                            aria-label="Quantity"
                          />
                          <input className="input min-h-7 w-14 px-1.5 py-0 text-sm" value={l.unit} onChange={(e) => editLine(l.id, { unit: e.target.value })} aria-label="Unit" maxLength={20} />
                        </span>
                      ) : (
                        qtyText(l)
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex flex-wrap items-center gap-1">
                        {c.templateIds.map((id) => {
                          const t = byId.get(id);
                          if (!t) return null;
                          return (
                            <span key={id} className="chip bg-surface-3 text-fg">
                              <CategoryDot category={t.category} />
                              {t.name}
                              <button type="button" className="ml-0.5 text-muted hover:text-brand-red" onClick={() => setChoice(l.id, { templateIds: c.templateIds.filter((x) => x !== id) })} aria-label={`Don't add ${t.name}`}>
                                ✕
                              </button>
                            </span>
                          );
                        })}
                        {c.include && <TemplatePicker catalog={catalog} exclude={c.templateIds} onPick={(id) => setChoice(l.id, { templateIds: [...c.templateIds, id] })} label={c.templateIds.length ? '+ another task' : 'Pick a task…'} />}
                        {c.include && !c.custom && (
                          <button
                            type="button"
                            className="text-xs font-medium text-brand-purple hover:underline"
                            onClick={() => setChoice(l.id, { custom: { name: l.name, category: guessCategory(l), rule: FIXED_ONE_DAY, saveToList: true } })}
                          >
                            + new task
                          </button>
                        )}
                        {!c.templateIds.length && !c.custom && c.include && <span className="chip bg-brand-yellow/30 text-warn-fg">No match</span>}
                      </div>
                      {c.include && handPicked && (
                        <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-strong">
                          <input type="checkbox" className="accent-brand-purple" checked={c.remember} onChange={(e) => setChoice(l.id, { remember: e.target.checked })} />
                          Remember: next time “{l.name}” brings in the tasks picked here
                        </label>
                      )}
                      {c.include && c.custom && (
                        <div className="mt-1.5 space-y-1.5 rounded-md border border-brand-purple/40 bg-brand-purple/5 p-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <input
                              className="input min-h-7 w-56 py-0 text-sm"
                              value={c.custom.name}
                              onChange={(e) => setChoice(l.id, { custom: { ...c.custom!, name: e.target.value } })}
                              aria-label="New task name"
                              maxLength={300}
                            />
                            <select className="input min-h-7 w-32 py-0 text-xs" value={c.custom.category} onChange={(e) => setChoice(l.id, { custom: { ...c.custom!, category: e.target.value as Category } })} aria-label="Category">
                              {CATEGORIES.map((k) => (
                                <option key={k} value={k}>
                                  {CATEGORY_SHORT[k]}
                                </option>
                              ))}
                            </select>
                            <button type="button" className="ml-auto text-xs text-muted hover:text-brand-red" onClick={() => setChoice(l.id, { custom: null })}>
                              Remove
                            </button>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-strong">
                            Takes <RuleEditor rule={c.custom.rule} onChange={(rule) => setChoice(l.id, { custom: { ...c.custom!, rule } })} editable />
                          </div>
                          <label className="flex items-center gap-1.5 text-xs text-muted-strong">
                            <input type="checkbox" className="accent-brand-purple" checked={c.custom.saveToList} onChange={(e) => setChoice(l.id, { custom: { ...c.custom!, saveToList: e.target.checked } })} />
                            Save to the Task Lists (this line will match it next time)
                          </label>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!lines.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-muted">
                    {onLinesChange ? 'No line items yet: add them below.' : 'This quote has no line items.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {onLinesChange && (
            <div className="border-t border-line bg-surface-2 px-3 py-2">
              <button type="button" className="text-sm font-medium text-brand-purple hover:underline" onClick={addLine}>
                + Add a line
              </button>
            </div>
          )}
        </div>
      </section>

      {autoAdd.length > 0 && (
        <section>
          <h3 className="mb-1 font-semibold">
            Always added <span className="font-normal text-muted">· ticked “Always” on the Task Lists page</span>
          </h3>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {autoAdd.map((t) => (
              <label key={t.id} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="accent-brand-purple"
                  checked={draft.extraTemplateIds.includes(t.id)}
                  onChange={(e) => onChange({ ...draft, extraTemplateIds: e.target.checked ? [...draft.extraTemplateIds, t.id] : draft.extraTemplateIds.filter((x) => x !== t.id) })}
                />
                <CategoryDot category={t.category} />
                {t.name}
              </label>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-1 font-semibold">
          Tasks to create <span className="font-normal text-muted">· {top.length} tasks, {plan.length - top.length} sub-tasks — all editable in the planner</span>
        </h3>
        <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-surface-2 col-head">
              <tr>
                <th className="px-2 py-1.5">Task</th>
                <th className="w-40 px-2 py-1.5">Quantity</th>
                <th className="w-20 px-2 py-1.5 text-right">Sub-tasks</th>
                <th className="w-32 px-2 py-1.5">Waits for</th>
                <th className="w-36 px-2 py-1.5">Dates</th>
                <th className="w-14 px-2 py-1.5 text-right">Days</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {top.map((p) => {
                const s = spanOf(p.key);
                const subs = plan.filter((x) => x.parentKey === p.key);
                const dep = p.dependsOnKey ? top.find((x) => x.key === p.dependsOnKey) : null;
                const warn = p.noQuantity || subs.some((x) => x.noQuantity);
                return (
                  <tr key={p.key}>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        <CategoryDot category={p.category} />
                        {p.title}
                        {!p.catalogItemId && <span className="chip bg-surface-3 text-muted-strong">this project only</span>}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-xs text-muted-strong tabular-nums" title={warn ? 'A quantity-based step found no quantity in its unit and uses its minimum days' : undefined}>
                      {describeQuantities(p.quantities) || '—'}
                      {warn && <span className="ml-1 text-warn-fg">⚠</span>}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{subs.length || ''}</td>
                    <td className="truncate px-2 py-1 text-xs text-muted-strong">{dep ? `↳ ${dep.title}` : ''}</td>
                    <td className="px-2 py-1 text-xs tabular-nums">{s ? `${formatShort(s.start)} → ${formatShort(s.end)}` : '—'}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{s ? workingDays(s.start, s.end) : ''}</td>
                  </tr>
                );
              })}
              {!top.length && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-muted">
                    Nothing yet: tick lines that match a task, or add new tasks.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/** A review draft for some lines: started once the lines and the Task Lists are in, started again when `key` changes. */
function useImportDraft(key: string | null, lines: QuoteLine[] | null, catalog: CatalogItemDto[] | undefined) {
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [key]);
  useEffect(() => {
    if (key && lines && catalog && !draft) setDraft(newDraft(lines, catalog));
  }, [key, lines, catalog, draft]);
  return { draft, setDraft };
}

/** Loads a quote's lines and keeps a review draft for them. */
export function useQuoteDraft(quoteId: string | null) {
  const lines = useQuoteLines(quoteId);
  const catalog = useCatalog();
  const { draft, setDraft } = useImportDraft(quoteId, lines.data && !lines.data.unavailable ? lines.data.lines : null, catalog.data);
  return { lines, catalog, draft, setDraft };
}

/** Lines read from a file (editable) and their review draft. */
export function useFileDraft() {
  const catalog = useCatalog();
  const [file, setFile] = useState<{ key: string; name: string; read: ReadFile } | null>(null);
  const [lines, setLines] = useState<QuoteLine[] | null>(null);
  const { draft, setDraft } = useImportDraft(file?.key ?? null, lines, catalog.data);
  const load = (name: string, read: ReadFile) => {
    setFile({ key: `${name}:${Date.now()}`, name, read });
    setLines(read.lines);
  };
  const clear = () => {
    setFile(null);
    setLines(null);
  };
  return { catalog, file, lines, setLines, draft, setDraft, load, clear };
}

/** Pick or drop an Excel, CSV or PDF BOQ; it is read here in the browser. */
export function BoqFilePicker({ onRead }: { onRead: (fileName: string, read: ReadFile) => void }) {
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const take = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProblem(null);
    try {
      const read = await readBoqFile(file);
      if (!read.lines.length) setProblem(`${file.name}: ${read.warnings.join('; ') || 'no line items found'}. You can still add the lines by hand.`);
      onRead(file.name, read);
    } catch (e) {
      setProblem(`${file.name} could not be read: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <label
        className={`flex cursor-pointer flex-col items-center justify-center gap-1 border-2 border-dashed px-6 py-10 text-center ${over ? 'border-brand-purple bg-brand-purple/5' : 'border-line-strong hover:bg-surface-2'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer.files[0]);
        }}
      >
        <input type="file" className="sr-only" accept={ACCEPTED_FILES} onChange={(e) => void take(e.target.files?.[0])} disabled={busy} />
        <span className="font-semibold">{busy ? 'Reading the file…' : 'Choose a BOQ file, or drop it here'}</span>
        <span className="text-sm text-muted">Excel (.xlsx), CSV or PDF. It is read on this computer; only the item names, units and quantities are kept — no rates or amounts.</span>
      </label>
      {problem && <div className="border border-brand-yellow/60 bg-brand-yellow/15 p-3 text-sm text-warn-fg">{problem}</div>}
    </div>
  );
}

function QuotePicker({ onPick }: { onPick: (q: { id: string; rootQuoteId: string; displayNo: string }) => void }) {
  const [q, setQ] = useState('');
  const quotes = useBoqQuotes(q, true);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-strong">This project isn't linked to a BOQ quote yet. Pick the quote to draft its tasks from (it will be linked).</p>
      <input className="input min-h-9 py-1" placeholder="Search quote no., client, project, location…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {quotes.data?.unavailable && <p className="text-sm text-warn-fg">{quotes.data.unavailable}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line empty:hidden">
        {quotes.data?.items.map((x) => (
          <li key={x.id}>
            <button
              type="button"
              disabled={!!x.linkedProjectId}
              onClick={() => onPick(x)}
              className="grid w-full grid-cols-[11rem_1fr_8rem] items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="font-mono text-xs">{x.displayNo}</span>
              <span className="truncate font-medium">{crmTitle(x.clientCompany, x.projectName) || '—'}</span>
              <span className="text-xs text-muted">{x.linkedProjectId ? 'Has a project' : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "⇣ From quote" on a project: draft (more) tasks from its quote, or pick a quote for a project without one. */
export function ImportQuoteDialog({ project, onClose }: { project: ProjectDto; onClose: () => void }) {
  const [quote, setQuote] = useState<{ id: string; rootQuoteId: string; displayNo: string } | null>(
    project.boqQuoteId ? { id: project.boqQuoteId, rootQuoteId: project.boqRootQuoteId ?? project.boqQuoteId, displayNo: project.boqQuoteNo } : null,
  );
  const [useFile, setUseFile] = useState(false);
  const fileDraft = useFileDraft();
  const { lines, catalog, draft, setDraft } = useQuoteDraft(useFile ? null : quote?.id ?? null);
  const run = useImportQuote(project.id);
  const submitFile = () => {
    if (!fileDraft.file || !fileDraft.draft || !fileDraft.lines) return;
    const lines = fileDraft.lines.filter((l) => l.name.trim());
    run.mutate(toImportInput(fileDraft.draft, { id: 'file', rootQuoteId: 'file', displayNo: fileDraft.file.name }, lines, 'file'), {
      onSuccess: (r) => {
        toast(`Added ${r.taskIds.length} tasks and sub-tasks from ${fileDraft.file!.name}`, { tone: 'ok' });
        onClose();
      },
      onError: (e) => toast(errorText(e), { tone: 'error' }),
    });
  };
  const submit = () => {
    if (useFile) return submitFile();
    if (!quote || !draft || !lines.data) return;
    run.mutate(toImportInput(draft, { ...quote, displayNo: quote.displayNo || lines.data.quote?.displayNo || '' }, lines.data.lines), {
      onSuccess: (r) => {
        toast(`Added ${r.taskIds.length} tasks and sub-tasks from ${quote.displayNo || 'the quote'}`, { tone: 'ok' });
        onClose();
      },
      onError: (e) => toast(errorText(e), { tone: 'error' }),
    });
  };
  return (
    <Modal
      title={`Tasks from ${quote?.displayNo ? `quote ${quote.displayNo}` : 'a BOQ quote'} · ${project.name}`}
      onClose={onClose}
      wide
      footer={
        (useFile ? fileDraft.draft : quote && draft) ? (
          <>
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-primary" onClick={submit} disabled={run.isPending}>
              {run.isPending ? 'Adding…' : 'Add to the planner'}
            </button>
          </>
        ) : undefined
      }
    >
      {!useFile && (
        <p className="mb-3 text-sm">
          <button type="button" className="font-medium text-brand-purple hover:underline" onClick={() => setUseFile(true)}>
            Use a BOQ file instead (Excel or PDF)
          </button>
        </p>
      )}
      {useFile && !fileDraft.file && <BoqFilePicker onRead={fileDraft.load} />}
      {useFile && fileDraft.file && fileDraft.draft && fileDraft.lines && fileDraft.catalog.data && (
        <>
          <p className="mb-3 text-sm">
            From <b>{fileDraft.file.name}</b>: {fileDraft.file.read.lines.length} lines read.{' '}
            <button type="button" className="text-brand-purple hover:underline" onClick={fileDraft.clear}>
              Choose another file
            </button>
          </p>
          <QuoteImportReview
            lines={fileDraft.lines}
            onLinesChange={fileDraft.setLines}
            catalog={fileDraft.catalog.data}
            draft={fileDraft.draft}
            onChange={fileDraft.setDraft}
            quoteLabel={fileDraft.file.name}
          />
        </>
      )}
      {!useFile && !quote && <QuotePicker onPick={setQuote} />}
      {!useFile && quote && (lines.isLoading || catalog.isLoading) && <p className="text-muted">Reading the quote's line items…</p>}
      {!useFile && quote && lines.data?.unavailable && (
        <div className="rounded-lg border border-brand-yellow/60 bg-brand-yellow/15 p-3 text-sm text-warn-fg">
          <b>Can't read the quote's line items right now.</b> {lines.data.unavailable}.
        </div>
      )}
      {!useFile && quote && draft && lines.data && catalog.data && (
        <>
          {project.boqQuoteId && <p className="mb-3 text-xs text-muted">The tasks are added after the project's current ones; nothing already in the planner changes.</p>}
          <QuoteImportReview lines={lines.data.lines} catalog={catalog.data} draft={draft} onChange={setDraft} quoteLabel={quote.displayNo} />
        </>
      )}
    </Modal>
  );
}
