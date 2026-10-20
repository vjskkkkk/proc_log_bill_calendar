import { useEffect, type ReactNode } from 'react';
import { CATEGORY_COLOR, CATEGORY_SHORT, isCategory } from '@shared/categories';

export function CategoryDot({ category, className = '' }: { category: string; className?: string }) {
  const c = isCategory(category) ? CATEGORY_COLOR[category].bg : '#717272';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 ${className}`} style={{ backgroundColor: c }} aria-hidden="true" />;
}

export function CategoryPill({ category }: { category: string }) {
  if (!isCategory(category)) return null;
  const c = CATEGORY_COLOR[category];
  return (
    <span className="chip" style={{ backgroundColor: `${c.bg}26`, color: 'var(--color-fg)' }}>
      <CategoryDot category={category} />
      {CATEGORY_SHORT[category]}
    </span>
  );
}

export function Modal({ title, onClose, children, wide = false, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 p-6 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[84vh] w-full flex-col rounded-xl bg-surface shadow-xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line p-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" className="ml-auto text-muted hover:text-fg" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line p-4">{footer}</div>}
      </div>
    </div>
  );
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

export function Avatar({ name, muted = false, size = 'sm' }: { name: string; muted?: boolean; size?: 'sm' | 'xs' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center font-semibold ${size === 'xs' ? 'h-5 w-5 text-[9px]' : 'h-6 w-6 text-[10px]'} ${
        muted ? 'bg-surface-3 text-muted-strong ring-1 ring-line-strong ring-dashed' : 'bg-brand-purple text-white'
      }`}
      title={name}
    >
      {initials(name)}
    </span>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
