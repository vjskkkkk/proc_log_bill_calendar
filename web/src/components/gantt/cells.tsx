import { useEffect, useRef, useState } from 'react';
import { CATEGORIES, CATEGORY_SHORT } from '@shared/categories';
import type { IsoDate } from '@shared/schedule/dates';
import { formatShort, todayIST } from '@shared/schedule/dates';
import { parseDateInput } from '@shared/schedule/parse';
import { toast } from '../../lib/toast';
import { CategoryDot } from '../ui';
import type { ColKey } from './layout';

interface NavProps {
  cellId: string;
  onArrow?: (delta: -1 | 1) => void;
}

function navKeys(e: React.KeyboardEvent, onArrow?: (d: -1 | 1) => void): boolean {
  if (!e.altKey && !e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    onArrow?.(e.key === 'ArrowUp' ? -1 : 1);
    return true;
  }
  return false;
}

/**
 * A date typed the way people write it (12/11, 12 nov, +5 …; shared/schedule/parse.ts), shown as "12 Nov".
 * Commits on Enter/blur only (a half-typed date is not a date). The 📅 button opens the browser's picker.
 */
export function DateCell({
  value,
  editable,
  onCommit,
  plusBase,
  plusIsLength,
  muted,
  danger,
  cellId,
  onArrow,
  label,
}: NavProps & {
  value: IsoDate | null;
  editable: boolean;
  onCommit: (d: IsoDate | null) => void;
  plusBase?: IsoDate | null;
  plusIsLength?: boolean;
  /** Inherited dates are shown greyed. */
  muted?: boolean;
  danger?: boolean;
  label: string;
}) {
  const shown = value ? formatShort(value) : '';
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  const editing = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);

  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    if (text.trim() === shown) return;
    const r = parseDateInput(text, { ref: todayIST(), ...(plusBase !== undefined ? { plusBase } : {}), ...(plusIsLength ? { plusIsLength } : {}) });
    if (!r.ok) {
      setBad(true);
      toast(`Couldn't read "${text}" as a date — try 12/11 or 12 Nov`, { tone: 'error' });
      setText(shown);
      return;
    }
    setBad(false);
    if (r.date !== value) onCommit(r.date);
    setText(r.date ? formatShort(r.date) : '');
  };

  if (!editable) return <span className={`block truncate px-2 text-sm tabular-nums ${muted ? 'text-muted italic' : ''} ${danger ? 'text-brand-red font-medium' : ''}`}>{shown}</span>;
  return (
    <div className="group/date relative h-full">
      <input
        data-cell={cellId}
        className={`cell-input tabular-nums pr-5 ${muted && !text ? '' : ''} ${danger ? 'text-brand-red font-medium' : ''} ${bad ? 'ring-2 ring-inset ring-brand-red/60' : ''}`}
        value={text}
        placeholder={muted ? '' : '—'}
        aria-label={label}
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => {
          editing.current = true;
          setBad(false);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
            e.currentTarget.select();
            editing.current = true;
          } else if (e.key === 'Escape') {
            editing.current = false;
            setText(shown);
            setBad(false);
          } else if (navKeys(e, onArrow)) commit();
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 rounded px-0.5 text-[11px] text-muted opacity-0 hover:text-fg group-hover/date:opacity-100"
        title="Pick a date"
        aria-label={`Pick ${label.toLowerCase()}`}
        onClick={() => {
          const el = picker.current;
          if (!el) return;
          el.value = value ?? '';
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        ▾
      </button>
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-0 opacity-0"
        onChange={(e) => e.target.value && e.target.value !== value && onCommit(e.target.value)}
      />
    </div>
  );
}

export function CategoryCell({ value, editable, onChange, cellId, onArrow }: NavProps & { value: string; editable: boolean; onChange: (v: string) => void }) {
  if (!editable)
    return (
      <span className="flex items-center gap-1.5 px-2 text-xs">
        <CategoryDot category={value} />
        {CATEGORY_SHORT[value as keyof typeof CATEGORY_SHORT] ?? value}
      </span>
    );
  return (
    <div className="flex h-full items-center gap-1 pl-2">
      <CategoryDot category={value} />
      <select
        data-cell={cellId}
        className="cell-input cursor-pointer appearance-none pl-1 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => navKeys(e, onArrow)}
        aria-label="Category"
      >
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_SHORT[c]}
          </option>
        ))}
      </select>
    </div>
  );
}

export function OwnerCell({
  value,
  inheritedName,
  owners,
  nameOf,
  editable,
  onChange,
  cellId,
  onArrow,
}: NavProps & {
  value: string | null;
  inheritedName: string | null;
  owners: { id: string; name: string }[];
  nameOf: (id: string | null) => string;
  editable: boolean;
  onChange: (v: string | null) => void;
}) {
  const label = value ? nameOf(value) : inheritedName ? `${inheritedName}` : '';
  if (!editable) return <span className={`block truncate px-2 text-xs ${value ? '' : 'text-muted italic'}`}>{label}</span>;
  const known = !value || owners.some((o) => o.id === value);
  return (
    <select
      data-cell={cellId}
      className={`cell-input cursor-pointer appearance-none text-xs ${value ? '' : 'text-muted italic'}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      onKeyDown={(e) => navKeys(e, onArrow)}
      aria-label="Owner"
      title={!value && inheritedName ? `Task owner: ${inheritedName}` : undefined}
    >
      <option value="">{inheritedName ? `${inheritedName} (task)` : '—'}</option>
      {!known && <option value={value!}>{nameOf(value)}</option>}
      {owners.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function DoneCell({ done, editable, onChange, cellId, onArrow, partial }: NavProps & { done: boolean; editable: boolean; onChange: (v: boolean) => void; partial?: string }) {
  return (
    <span className="flex h-full items-center justify-center" title={partial}>
      <input
        type="checkbox"
        data-cell={cellId}
        className="h-4 w-4 cursor-pointer accent-brand-green disabled:cursor-default"
        checked={done}
        disabled={!editable}
        onChange={(e) => onChange(e.target.checked)}
        onKeyDown={(e) => navKeys(e, onArrow)}
        aria-label={done ? 'Done' : 'Not done'}
      />
    </span>
  );
}

export type { ColKey };
