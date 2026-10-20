import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT, isCategory, type Category } from '@shared/categories';
import type { CatalogItemDto } from '@shared/schemas/plan';
import { useCreateCatalogItem } from '../../api/catalog';
import { toast } from '../../lib/toast';
import { CategoryDot } from '../ui';

type Option = { kind: 'text'; text: string } | { kind: 'item'; item: CatalogItemDto; group: string } | { kind: 'save'; text: string };

export interface TitleComboboxProps {
  value: string;
  /** 'task' rows suggest task templates; 'subtask' rows suggest standard steps (the parent template's first). */
  level: 'task' | 'subtask';
  category: string;
  parentCatalogId: string | null;
  catalog: CatalogItemDto[];
  editable: boolean;
  placeholder?: string;
  className?: string;
  cellId: string;
  /** Free text committed (blur, Enter, Tab). Return nothing. */
  onCommit: (text: string) => void;
  onPick: (item: CatalogItemDto) => void;
  /** "Save to the Task Lists" was chosen (the caller asks how its days work); default: save with one fixed day. */
  onSaveNew?: (text: string) => void;
  /** Enter after committing (create the next row). `mod` = Ctrl/⌘ held. */
  onEnter?: (mod: boolean) => void;
  onArrow?: (delta: -1 | 1) => void;
  onAltArrow?: (delta: -1 | 1) => void;
  /** Add rows clear after each entry. */
  clearOnCommit?: boolean;
  autoFocus?: boolean;
}

function matches(name: string, q: string) {
  return !q || name.toLowerCase().includes(q);
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-brand-yellow/50 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function TitleCombobox(p: TitleComboboxProps) {
  const [text, setText] = useState(p.value);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const saveToCatalog = useCreateCatalogItem();

  useEffect(() => {
    if (!dirty.current) setText(p.value);
  }, [p.value]);

  const q = text.trim().toLowerCase();
  const options = useMemo<Option[]>(() => {
    if (!open) return [];
    const out: Option[] = [];
    const cat = isCategory(p.category) ? p.category : null;
    const items = p.catalog;
    const exact = items.some((i) => i.name.toLowerCase() === q);
    if (q && !exact) out.push({ kind: 'text', text: text.trim() });
    const push = (list: CatalogItemDto[], group: string) => {
      for (const item of list) if (matches(item.name, q) && out.length < 40) out.push({ kind: 'item', item, group });
    };
    if (p.level === 'task') {
      const order: Category[] = cat ? [cat, ...CATEGORIES.filter((c) => c !== cat)] : [...CATEGORIES];
      for (const c of order) push(items.filter((i) => !i.parentId && i.category === c), CATEGORY_LABEL[c]);
    } else {
      const seen = new Set<string>();
      if (p.parentCatalogId) {
        const own = items.filter((i) => i.parentId === p.parentCatalogId);
        own.forEach((i) => seen.add(i.id));
        push(own, 'Sub-tasks of this Task List task');
      }
      const sameCat = items.filter((i) => i.parentId && !seen.has(i.id) && (!cat || i.category === cat));
      // De-duplicate identical step names across templates ("Raise PO" appears in several).
      const byName = new Map<string, CatalogItemDto>();
      for (const i of sameCat) if (!byName.has(i.name.toLowerCase())) byName.set(i.name.toLowerCase(), i);
      push([...byName.values()], cat ? `Other ${CATEGORY_SHORT[cat].toLowerCase()} sub-tasks` : 'Other sub-tasks');
    }
    if (p.editable && q && !exact) out.push({ kind: 'save', text: text.trim() });
    return out;
  }, [open, p.catalog, p.category, p.level, p.parentCatalogId, p.editable, q, text]);

  useLayoutEffect(() => {
    if (open && inputRef.current) setRect(inputRef.current.getBoundingClientRect());
  }, [open, text]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && (e.target as HTMLElement).closest?.('[data-combobox-list]')) return;
      setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  useEffect(() => {
    if (p.autoFocus) inputRef.current?.focus();
  }, [p.autoFocus]);

  const commit = () => {
    const v = text.trim();
    if (dirty.current) {
      dirty.current = false;
      if (v && v !== p.value) p.onCommit(v);
      else if (!v) setText(p.value);
    }
    if (p.clearOnCommit) setText('');
  };

  const pick = (o: Option) => {
    setOpen(false);
    if (o.kind === 'item') {
      dirty.current = false;
      setText(p.clearOnCommit ? '' : o.item.name);
      p.onPick(o.item);
    } else if (o.kind === 'text') {
      commit();
    } else if (p.onSaveNew) {
      dirty.current = false;
      setText(p.clearOnCommit ? '' : p.value);
      p.onSaveNew(o.text);
    } else {
      const parentId = p.level === 'subtask' ? p.parentCatalogId : null;
      const category = (isCategory(p.category) ? p.category : 'material') as Category;
      saveToCatalog.mutate(
        { category, parentId, name: o.text },
        {
          onSuccess: (r) => {
            const item = (r as { item?: CatalogItemDto }).item;
            toast(`Saved "${o.text}" to the Task Lists`, { tone: 'ok' });
            if (item) {
              dirty.current = false;
              setText(p.clearOnCommit ? '' : item.name);
              p.onPick(item);
            }
          },
        },
      );
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      p.onAltArrow?.(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (open && options.length) {
        e.preventDefault();
        setHi((h) => (h + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        return;
      }
      if (e.key === 'ArrowDown' && (e.ctrlKey || e.metaKey || !text)) {
        e.preventDefault();
        setOpen(true);
        setHi(0);
        return;
      }
      e.preventDefault();
      commit();
      p.onArrow?.(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const o = open ? options[hi] : undefined;
      if (o && o.kind !== 'text') {
        pick(o);
        return;
      }
      setOpen(false);
      const had = text.trim();
      commit();
      if (had || !p.clearOnCommit) p.onEnter?.(e.ctrlKey || e.metaKey);
      return;
    }
    if (e.key === 'Escape') {
      if (open) setOpen(false);
      else {
        dirty.current = false;
        setText(p.clearOnCommit ? '' : p.value);
        e.currentTarget.blur();
      }
    }
  };

  const list =
    open && rect && options.length > 0
      ? createPortal(
          <ul
            data-combobox-list
            role="listbox"
            className="fixed z-50 max-h-80 overflow-y-auto rounded-lg border border-line-strong bg-surface py-1 text-sm shadow-xl"
            style={{ left: rect.left, top: rect.bottom + 2, width: Math.max(rect.width, 340) }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => {
              const prev = options[i - 1];
              const header = o.kind === 'item' && (!prev || prev.kind !== 'item' || prev.group !== o.group) ? o.group : null;
              return (
                <li key={o.kind === 'item' ? o.item.id : `${o.kind}:${i}`}>
                  {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{header}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === hi ? 'bg-brand-purple/10' : 'hover:bg-surface-3'}`}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(o)}
                  >
                    {o.kind === 'text' && (
                      <>
                        <span className="text-muted">Use</span> <span className="font-medium">“{o.text}”</span>
                        <span className="ml-auto text-xs text-muted">Enter</span>
                      </>
                    )}
                    {o.kind === 'item' && (
                      <>
                        <CategoryDot category={o.item.category} />
                        <span className="truncate">
                          <Highlight text={o.item.name} q={q} />
                        </span>
                        {!o.item.parentId && p.level === 'task' && (
                          <span className="ml-auto shrink-0 text-xs text-muted">{p.catalog.filter((c) => c.parentId === o.item.id).length} sub-tasks</span>
                        )}
                      </>
                    )}
                    {o.kind === 'save' && (
                      <span className="text-brand-purple">
                        + Save “{o.text}” to the Task Lists
                        {p.level === 'subtask' && p.parentCatalogId ? ' as a sub-task' : isCategory(p.category) ? ` (${CATEGORY_SHORT[p.category]})` : ''}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>,
          document.body,
        )
      : null;

  return (
    <>
      <input
        ref={inputRef}
        data-cell={p.cellId}
        className={p.className ?? 'cell-input'}
        value={text}
        placeholder={p.placeholder}
        disabled={!p.editable}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-label="Title"
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
          setOpen(true);
          setHi(0);
        }}
        onBlur={() => {
          setOpen(false);
          commit();
        }}
        onKeyDown={onKeyDown}
        maxLength={300}
      />
      {list}
    </>
  );
}
