import { useMemo, useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, type Category } from '@shared/categories';
import { FIXED_ONE_DAY, type CatalogItemDto } from '@shared/schemas/plan';
import { propagate, type SchedTask } from '@shared/schedule/deps';
import { ruleDays, type DurationRule, type Quantities } from '@shared/schedule/rules';
import { endAfter, workingDays } from '@shared/schedule/workdays';
import { canEdit, type UserPublic } from '@shared/types';
import { useCatalog, useCreateCatalogItem, useDeleteCatalogItem, usePatchCatalogItem, useReorderCatalog } from '../api/catalog';
import { RuleEditor } from '../components/RuleEditor';
import { useCommittedInput } from '../lib/autosave';
import { readPref, writePref } from '../lib/prefs';

const GRID = 'grid grid-cols-[1.5rem_minmax(13rem,1fr)_minmax(17rem,auto)_13rem_minmax(10rem,14rem)_4rem_3.5rem] items-center gap-x-2';

/**
 * Working days a task takes for `q`: its own rule, or its sub-tasks laid out with their dependencies (the same engine
 * the planner uses). `scaled` = some rule depends on the quantity.
 */
function taskDays(task: CatalogItemDto, steps: CatalogItemDto[], q: Quantities): { days: number; scaled: boolean } {
  if (!steps.length) return { days: ruleDays(task.rule, q).days, scaled: task.rule.mode === 'per_qty' };
  const start = '2026-01-05';
  const ids = new Set(steps.map((s) => s.id));
  const sched: SchedTask[] = steps.map((s) => {
    const days = ruleDays(s.rule, q).days;
    const dep = s.dependsOnId && ids.has(s.dependsOnId) ? s.dependsOnId : null;
    return { id: s.id, projectId: 'x', parentId: null, startDate: dep ? null : start, endDate: dep ? null : endAfter(start, days), dependsOnId: dep, plannedDays: days };
  });
  const moved = new Map(propagate(sched).map((c) => [c.id, c]));
  const ends = sched.map((s) => moved.get(s.id)?.endDate ?? s.endDate).filter(Boolean) as string[];
  const last = ends.reduce((a, b) => (b > a ? b : a), start);
  return { days: workingDays(start, last), scaled: steps.some((s) => s.rule.mode === 'per_qty') };
}

function NameInput({ item, editable }: { item: CatalogItemDto; editable: boolean }) {
  const patch = usePatchCatalogItem();
  const f = useCommittedInput(item.name, (v) => v.trim() && v.trim() !== item.name && patch.mutate({ id: item.id, name: v.trim() }), 0);
  if (!editable) return <span className="truncate px-2 py-1">{item.name}</span>;
  return (
    <input
      className="cell-input h-8 min-w-0"
      value={f.value}
      onChange={(e) => f.onChange(e.target.value)}
      onBlur={f.flush}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') f.reset();
      }}
      aria-label="Name"
    />
  );
}

function MatchWords({ item, editable }: { item: CatalogItemDto; editable: boolean }) {
  const patch = usePatchCatalogItem();
  const [editing, setEditing] = useState(false);
  const shown = item.boqMatch.join(', ');
  const f = useCommittedInput(shown, (v) => {
    const words = v.split(',').map((w) => w.trim()).filter(Boolean);
    if (words.join(', ') !== shown) patch.mutate({ id: item.id, boqMatch: words });
  }, 0);
  if (editing && editable) {
    return (
      <input
        className="input min-h-7 py-0 text-xs"
        autoFocus
        value={f.value}
        placeholder="e.g. verde, kryoturf"
        onChange={(e) => f.onChange(e.target.value)}
        onBlur={() => {
          f.flush();
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            f.reset();
            setEditing(false);
          }
        }}
        aria-label="BOQ match words, comma separated"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={!editable}
      onClick={() => setEditing(true)}
      className="truncate rounded px-1.5 py-0.5 text-left text-xs text-muted hover:bg-surface-3 hover:text-fg disabled:hover:bg-transparent"
      title={item.boqMatch.length ? `Quote lines containing: ${shown}` : editable ? 'Add words from BOQ item names or codes that should bring in this task' : 'No BOQ match words'}
    >
      {item.boqMatch.length ? shown : editable ? '+ match words' : '—'}
    </button>
  );
}

function RowTools({ item, siblings, editable, label }: { item: CatalogItemDto; siblings: CatalogItemDto[]; editable: boolean; label: string }) {
  const reorder = useReorderCatalog();
  const del = useDeleteCatalogItem();
  if (!editable) return <span />;
  const i = siblings.findIndex((s) => s.id === item.id);
  const move = (dir: -1 | 1) => {
    const ids = siblings.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  return (
    <span className="invisible flex shrink-0 items-center justify-end gap-0.5 text-muted group-hover:visible group-focus-within:visible">
      <button type="button" className="rounded px-1 hover:bg-surface-3 hover:text-fg disabled:opacity-30" onClick={() => move(-1)} disabled={i === 0} aria-label="Move up" title="Move up">
        ↑
      </button>
      <button type="button" className="rounded px-1 hover:bg-surface-3 hover:text-fg disabled:opacity-30" onClick={() => move(1)} disabled={i === siblings.length - 1} aria-label="Move down" title="Move down">
        ↓
      </button>
      <button
        type="button"
        className="rounded px-1 hover:bg-brand-red/10 hover:text-brand-red"
        onClick={() => window.confirm(`Remove "${item.name}" ${label}? Planner tasks already using it keep their title.`) && del.mutate(item.id)}
        aria-label="Remove"
        title="Remove"
      >
        ✕
      </button>
    </span>
  );
}

/** "Waits for": independent, or after another task (tasks) / another sub-task of the same task (sub-tasks). */
function WaitsFor({ item, options, editable, independentLabel }: { item: CatalogItemDto; options: { id: string; label: string; group?: string }[]; editable: boolean; independentLabel: string }) {
  const patch = usePatchCatalogItem();
  const current = options.find((o) => o.id === item.dependsOnId);
  if (!editable) return <span className="truncate text-xs text-muted">{current ? `After ${current.label}` : independentLabel}</span>;
  const groups = [...new Set(options.map((o) => o.group ?? ''))];
  return (
    <select
      className={`input min-h-7 cursor-pointer truncate py-0 text-xs ${item.dependsOnId ? '' : 'text-muted'}`}
      value={item.dependsOnId ?? ''}
      onChange={(e) => patch.mutate({ id: item.id, dependsOnId: e.target.value || null })}
      aria-label="Waits for"
      title={current ? `Starts after "${current.label}" ends` : independentLabel}
    >
      <option value="">{independentLabel}</option>
      {groups.map((g) =>
        g ? (
          <optgroup key={g} label={g}>
            {options.filter((o) => o.group === g).map((o) => (
              <option key={o.id} value={o.id}>
                After: {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          options.filter((o) => !o.group).map((o) => (
            <option key={o.id} value={o.id}>
              After: {o.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string, rule: DurationRule) => Promise<unknown> }) {
  const [v, setV] = useState('');
  const [rule, setRule] = useState<DurationRule>(FIXED_ONE_DAY);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = v.trim();
    if (!name) return;
    onAdd(name, rule).then(() => {
      setV('');
      setRule(FIXED_ONE_DAY);
    }, () => undefined);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <input className="input min-h-8 min-w-56 flex-1 py-1 text-sm" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} />
      <span className="text-xs text-muted">takes</span>
      <RuleEditor rule={rule} onChange={setRule} editable />
      <button className="btn-secondary min-h-8 py-0.5" disabled={!v.trim()}>
        Add
      </button>
    </form>
  );
}

function CategoryCard({ category, items, editable, open, toggle, q, filter }: { category: Category; items: CatalogItemDto[]; editable: boolean; open: Set<string>; toggle: (id: string) => void; q: Quantities; filter: string }) {
  const create = useCreateCatalogItem();
  const patch = usePatchCatalogItem();
  const all = items.filter((i) => !i.parentId).sort((a, b) => CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category) || a.sortOrder - b.sortOrder);
  const tasks = all.filter((i) => i.category === category);
  const stepsOf = (id: string) => items.filter((i) => i.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const f = filter.trim().toLowerCase();
  const shown = f ? tasks.filter((t) => [t.name, ...t.boqMatch, ...stepsOf(t.id).map((s) => s.name)].some((x) => x.toLowerCase().includes(f))) : tasks;
  if (f && !shown.length) return null;
  const c = CATEGORY_COLOR[category];
  const taskOptions = (self: string) => all.filter((t) => t.id !== self).map((t) => ({ id: t.id, label: t.name, group: CATEGORY_LABEL[t.category] }));
  return (
    <section className="card overflow-hidden p-0">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${c.bg}` }}>
        <h2 className="font-semibold">{CATEGORY_LABEL[category]}</h2>
        <span className="text-xs text-muted">{tasks.length} tasks</span>
      </header>
      <div className={`${GRID} border-b border-line bg-surface-2 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted`}>
        <span />
        <span className="px-2">Task / sub-task</span>
        <span>Days to complete</span>
        <span>Waits for</span>
        <span title="Quote lines whose item name contains one of these words (or whose code equals one) bring in this task">BOQ match</span>
        <span title="Added to every project drafted from a quote">Always</span>
        <span />
      </div>
      <ul className="divide-y divide-line">
        {shown.map((t) => {
          const st = stepsOf(t.id);
          const isOpen = open.has(t.id) || (!!f && st.some((s) => s.name.toLowerCase().includes(f)));
          const total = taskDays(t, st, q);
          return (
            <li key={t.id} className="px-2 py-1">
              <div className={`group ${GRID}`}>
                <button type="button" className="text-muted hover:text-fg" onClick={() => toggle(t.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Hide sub-tasks' : 'Show sub-tasks'}>
                  {isOpen ? '▾' : '▸'}
                </button>
                <NameInput item={t} editable={editable} />
                {st.length ? (
                  <button type="button" className="text-left text-sm tabular-nums" onClick={() => toggle(t.id)} title="Its sub-tasks, one after another as they wait for each other. Change their days to change this.">
                    <b>{total.days} d</b>
                    <span className="text-muted">
                      {' '}
                      · {st.length} sub-tasks{total.scaled ? ' · grows with quantity' : ''}
                    </span>
                  </button>
                ) : (
                  <RuleEditor rule={t.rule} editable={editable} onChange={(rule) => patch.mutate({ id: t.id, rule })} />
                )}
                <WaitsFor item={t} options={taskOptions(t.id)} editable={editable} independentLabel="Independent" />
                <MatchWords item={t} editable={editable} />
                <label className="flex justify-center" title="Add this task to every project drafted from a quote">
                  <input type="checkbox" className="h-4 w-4 accent-brand-purple" checked={t.autoAdd} disabled={!editable} onChange={(e) => patch.mutate({ id: t.id, autoAdd: e.target.checked })} aria-label="Always add to quote projects" />
                </label>
                <RowTools item={t} siblings={tasks} editable={editable} label="and its sub-tasks" />
              </div>
              {isOpen && (
                <ul className="mb-2 ml-6 border-l-2 border-line pl-1">
                  {st.map((s) => (
                    <li key={s.id} className={`group ${GRID} text-sm`}>
                      <span />
                      <NameInput item={s} editable={editable} />
                      <span className="flex items-center gap-2">
                        <RuleEditor rule={s.rule} editable={editable} onChange={(rule) => patch.mutate({ id: s.id, rule })} />
                        {s.rule.mode === 'per_qty' && <span className="text-xs text-muted tabular-nums">→ {ruleDays(s.rule, q).days} d</span>}
                      </span>
                      <WaitsFor item={s} options={st.filter((x) => x.id !== s.id).map((x) => ({ id: x.id, label: x.name }))} editable={editable} independentLabel="Starts with the task" />
                      <span />
                      <span />
                      <RowTools item={s} siblings={st} editable={editable} label="from the sub-tasks" />
                    </li>
                  ))}
                  {!st.length && <li className="px-2 py-1 text-xs text-muted">No sub-tasks: the task's own days apply.</li>}
                  {editable && (
                    <li className="py-1.5 pl-8">
                      <AddRow
                        placeholder="Add a sub-task…"
                        onAdd={(name, rule) => create.mutateAsync({ category, parentId: t.id, name, rule, dependsOnId: st.at(-1)?.id ?? null })}
                      />
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {editable && !f && (
        <div className="border-t border-line bg-surface-2 p-3">
          <AddRow placeholder={`Add a ${CATEGORY_LABEL[category].toLowerCase()} task…`} onAdd={(name, rule) => create.mutateAsync({ category, name, rule })} />
        </div>
      )}
    </section>
  );
}

function QtyBox({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <label className="inline-flex items-center gap-1 text-sm text-muted-strong">
      <input
        className="input min-h-8 w-24 px-2 py-0.5 text-right tabular-nums"
        inputMode="decimal"
        value={value ?? ''}
        placeholder="0"
        onChange={(e) => {
          const n = Number(e.target.value.replace(/,/g, ''));
          onChange(e.target.value.trim() && Number.isFinite(n) && n >= 0 ? n : undefined);
        }}
      />
      {label}
    </label>
  );
}

export default function TaskListsPage({ user }: { user: UserPublic }) {
  const catalog = useCatalog();
  const editable = canEdit(user.role);
  const [open, setOpen] = useState<Set<string>>(() => new Set(readPref<string[]>('taskLists.open', [])));
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState<Quantities>(() => readPref<Quantities>('taskLists.sample', { sqft: 8000, nos: 8, rmt: 200 }));
  const setQty = (k: keyof Quantities, v: number | undefined) => {
    const next = { ...q, [k]: v };
    if (v === undefined) delete next[k];
    setQ(next);
    writePref('taskLists.sample', next);
  };
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      writePref('taskLists.open', [...n]);
      return n;
    });
  const items = catalog.data ?? [];
  const taskIds = useMemo(() => items.filter((i) => !i.parentId).map((i) => i.id), [items]);
  const allOpen = taskIds.length > 0 && taskIds.every((id) => open.has(id));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">Task Lists</h1>
          <p className="max-w-4xl text-sm text-muted">
            The tasks a project needs, with their sub-tasks and how many working days each takes (Sundays off) — fixed, or worked out from the quote's
            quantity. A project started from a BOQ quote gets every task whose <b>BOQ match</b> words appear in its line items, with these days and
            dependencies; everything stays editable in the planner.{editable ? ' Click a name to rename it.' : ''}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <input className="input min-h-8 w-64 py-0.5 text-sm" placeholder="Find a task, sub-task or match word…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="mx-1 h-6 w-px bg-line" />
        <span className="text-sm text-muted-strong" title="Days shown for quantity-based tasks use these example quantities">
          Days shown for a job of
        </span>
        <QtyBox label="sqft" value={q.sqft} onChange={(v) => setQty('sqft', v)} />
        <QtyBox label="nos" value={q.nos} onChange={(v) => setQty('nos', v)} />
        <QtyBox label="rmt" value={q.rmt} onChange={(v) => setQty('rmt', v)} />
        <button
          type="button"
          className="ml-auto text-sm text-brand-purple hover:underline"
          onClick={() => {
            const n = allOpen ? new Set<string>() : new Set(taskIds);
            setOpen(n);
            writePref('taskLists.open', [...n]);
          }}
        >
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      {catalog.isLoading && <p className="text-muted">Loading…</p>}
      <div className="space-y-4">
        {CATEGORIES.map((c) => (
          <CategoryCard key={c} category={c} items={items} editable={editable} open={open} toggle={toggle} q={q} filter={filter} />
        ))}
      </div>
    </div>
  );
}
