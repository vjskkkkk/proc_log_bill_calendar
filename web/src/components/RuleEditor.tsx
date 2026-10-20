import { useEffect, useState } from 'react';
import { describeRule, RULE_UNITS, UNIT_LABEL, type DurationRule, type RuleUnit } from '@shared/schedule/rules';

/** A number box that commits on blur/Enter, only when it holds a valid, changed value (Esc restores). */
function Num({ value, onCommit, min, step, width, label, disabled }: { value: number; onCommit: (n: number) => void; min: number; step: number; width: string; label: string; disabled?: boolean }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(n) || n < min) return setText(String(value));
    if (n !== value) onCommit(n);
  };
  return (
    <input
      className={`input min-h-7 px-1.5 py-0 text-right text-sm tabular-nums ${width}`}
      inputMode="decimal"
      value={text}
      disabled={disabled}
      aria-label={label}
      title={label}
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setText(String(value));
      }}
    />
  );
}

/**
 * A Task List duration rule: "Fixed · 3 d" or "1 d per 4,000 sqft · min 2". Every change commits a whole, valid rule.
 * Read-only: the rule as text.
 */
export function RuleEditor({ rule, onChange, editable, className = '' }: { rule: DurationRule; onChange: (r: DurationRule) => void; editable: boolean; className?: string }) {
  if (!editable) return <span className={`text-sm tabular-nums text-muted-strong ${className}`}>{describeRule(rule)}</span>;
  const perQty = rule.mode === 'per_qty';
  return (
    <span className={`inline-flex flex-wrap items-center gap-1 text-sm text-muted-strong ${className}`}>
      <select
        className="input min-h-7 w-[5.5rem] cursor-pointer px-1.5 py-0 text-sm"
        value={rule.mode}
        aria-label="How the days are worked out"
        onChange={(e) =>
          onChange(
            e.target.value === 'per_qty'
              ? { mode: 'per_qty', days: 1, perQty: 1000, unit: 'sqft', minDays: Math.max(1, Math.round(rule.days)) }
              : { mode: 'fixed', days: Math.max(1, rule.minDays || Math.round(rule.days)), perQty: null, unit: null, minDays: 1 },
          )
        }
      >
        <option value="fixed">Fixed</option>
        <option value="per_qty">Per qty</option>
      </select>
      <Num value={rule.days} min={0.1} step={0.5} width="w-12" label={perQty ? 'Days per quantity' : 'Days'} onCommit={(days) => onChange({ ...rule, days })} />
      <span>d</span>
      {perQty && (
        <>
          <span>per</span>
          <Num value={rule.perQty ?? 1} min={0.01} step={100} width="w-20" label="Quantity" onCommit={(n) => onChange({ ...rule, perQty: n })} />
          <select
            className="input min-h-7 w-16 cursor-pointer px-1 py-0 text-sm"
            value={rule.unit ?? 'sqft'}
            aria-label="Unit"
            onChange={(e) => onChange({ ...rule, unit: e.target.value as RuleUnit })}
          >
            {RULE_UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABEL[u]}
              </option>
            ))}
          </select>
          <span>min</span>
          <Num value={rule.minDays} min={1} step={1} width="w-10" label="Minimum days" onCommit={(n) => onChange({ ...rule, minDays: Math.round(n) })} />
        </>
      )}
    </span>
  );
}
