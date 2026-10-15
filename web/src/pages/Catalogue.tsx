import { useState, type FormEvent } from 'react';
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, type Category } from '@shared/categories';
import type { CatalogItemDto } from '@shared/schemas/plan';
import { canEdit, type UserPublic } from '@shared/types';
import { useCatalog, useCreateCatalogItem, useDeleteCatalogItem, usePatchCatalogItem, useReorderCatalog } from '../api/catalog';
import { useCommittedInput } from '../lib/autosave';

function NameInput({ item, editable }: { item: CatalogItemDto; editable: boolean }) {
  const patch = usePatchCatalogItem();
  const f = useCommittedInput(item.name, (v) => v.trim() && v.trim() !== item.name && patch.mutate({ id: item.id, name: v.trim() }), 0);
  if (!editable) return <span className="flex-1 truncate px-2 py-1">{item.name}</span>;
  return (
    <input
      className="cell-input h-8 flex-1"
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

function RowTools({ item, siblings, editable, label }: { item: CatalogItemDto; siblings: CatalogItemDto[]; editable: boolean; label: string }) {
  const reorder = useReorderCatalog();
  const del = useDeleteCatalogItem();
  if (!editable) return null;
  const i = siblings.findIndex((s) => s.id === item.id);
  const move = (dir: -1 | 1) => {
    const ids = siblings.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    reorder.mutate(ids);
  };
  return (
    <span className="invisible flex shrink-0 items-center gap-0.5 text-muted group-hover:visible group-focus-within:visible">
      <button type="button" className="rounded px-1 hover:bg-surface-3 hover:text-fg disabled:opacity-30" onClick={() => move(-1)} disabled={i === 0} aria-label="Move up" title="Move up">
        ↑
      </button>
      <button type="button" className="rounded px-1 hover:bg-surface-3 hover:text-fg disabled:opacity-30" onClick={() => move(1)} disabled={i === siblings.length - 1} aria-label="Move down" title="Move down">
        ↓
      </button>
      <button
        type="button"
        className="rounded px-1 hover:bg-brand-red/10 hover:text-brand-red"
        onClick={() => window.confirm(`Remove "${item.name}" ${label}? Tasks already using it keep their title.`) && del.mutate(item.id)}
        aria-label="Remove"
        title="Remove"
      >
        ✕
      </button>
    </span>
  );
}

function AddInput({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<unknown> }) {
  const [v, setV] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = v.trim();
    if (!name) return;
    onAdd(name).then(() => setV(''), () => undefined);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <input className="input min-h-8 flex-1 py-1 text-sm" placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} maxLength={300} />
      <button className="btn-secondary min-h-8 py-0.5" disabled={!v.trim()}>
        Add
      </button>
    </form>
  );
}

function CategoryCard({ category, items, editable }: { category: Category; items: CatalogItemDto[]; editable: boolean }) {
  const create = useCreateCatalogItem();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const templates = items.filter((i) => i.category === category && !i.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const steps = (id: string) => items.filter((i) => i.parentId === id).sort((a, b) => a.sortOrder - b.sortOrder);
  const toggle = (id: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const c = CATEGORY_COLOR[category];
  return (
    <section className="card p-0 overflow-hidden">
      <header className="flex items-center gap-2 border-b border-line px-4 py-3" style={{ boxShadow: `inset 4px 0 0 ${c.bg}` }}>
        <h2 className="font-semibold">{CATEGORY_LABEL[category]}</h2>
        <span className="text-xs text-muted">{templates.length} tasks</span>
      </header>
      <ul className="divide-y divide-line">
        {templates.map((t) => {
          const st = steps(t.id);
          const isOpen = open.has(t.id);
          return (
            <li key={t.id} className="px-2 py-1">
              <div className="group flex items-center gap-1">
                <button type="button" className="w-6 shrink-0 text-muted hover:text-fg" onClick={() => toggle(t.id)} aria-expanded={isOpen} aria-label={isOpen ? 'Hide steps' : 'Show steps'}>
                  {isOpen ? '▾' : '▸'}
                </button>
                <NameInput item={t} editable={editable} />
                <span className="shrink-0 text-xs text-muted tabular-nums">{st.length} steps</span>
                <RowTools item={t} siblings={templates} editable={editable} label="and its standard steps" />
              </div>
              {isOpen && (
                <ul className="mb-2 ml-7 border-l-2 border-line pl-2">
                  {st.map((s) => (
                    <li key={s.id} className="group flex items-center gap-1 text-sm">
                      <NameInput item={s} editable={editable} />
                      <RowTools item={s} siblings={st} editable={editable} label="from the standard steps" />
                    </li>
                  ))}
                  {!st.length && <li className="px-2 py-1 text-xs text-muted">No standard steps.</li>}
                  {editable && (
                    <li className="pt-1">
                      <AddInput placeholder="Add a standard step…" onAdd={(name) => create.mutateAsync({ category, parentId: t.id, name })} />
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <div className="border-t border-line bg-surface-2 p-3">
          <AddInput placeholder={`Add a common ${CATEGORY_LABEL[category].toLowerCase()} task…`} onAdd={(name) => create.mutateAsync({ category, name })} />
        </div>
      )}
    </section>
  );
}

export default function CataloguePage({ user }: { user: UserPublic }) {
  const catalog = useCatalog();
  const editable = canEdit(user.role);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">Catalogue</h1>
        <p className="text-sm text-muted">
          Common tasks and their standard steps. In the planner, a task's title field suggests these; picking a task here also adds its steps as
          sub-tasks. Titles can always be typed freely.{editable ? ' Click a name to rename it.' : ''}
        </p>
      </div>
      {catalog.isLoading && <p className="text-muted">Loading…</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {CATEGORIES.map((c) => (
          <CategoryCard key={c} category={c} items={catalog.data ?? []} editable={editable} />
        ))}
      </div>
    </div>
  );
}
