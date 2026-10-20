/**
 * Task List duration rules: how many working days a task takes, either fixed or from the quantity in the quote.
 *
 *   fixed   — `days` working days, whatever the quantity (Raise PO = 1, supplier production = 15).
 *   per_qty — `days` working days per `perQty` units of `unit`, rounded up, never less than `minDays`
 *             (turf laying = 1 day per 4,000 sqft, min 2 → 8,000 sqft takes 2 days, 18,000 sqft takes 5).
 *
 * Quantities travel as a map by unit ({ sqft: 8000, rmt: 340, nos: 4 }) so one task can carry an area and a length;
 * a rule reads the quantity in its own unit, converting sqm↔sqft and rmt↔rft.
 */
export const DURATION_MODES = ['fixed', 'per_qty'] as const;
export type DurationMode = (typeof DURATION_MODES)[number];

export const RULE_UNITS = ['sqft', 'sqm', 'rmt', 'rft', 'nos'] as const;
export type RuleUnit = (typeof RULE_UNITS)[number];

export const UNIT_LABEL: Record<RuleUnit, string> = { sqft: 'sqft', sqm: 'sqm', rmt: 'rmt', rft: 'rft', nos: 'nos' };

export interface DurationRule {
  mode: DurationMode;
  /** Fixed: the working days. Per qty: working days per `perQty` units. */
  days: number;
  perQty: number | null;
  unit: RuleUnit | null;
  minDays: number;
}

export type Quantities = Partial<Record<RuleUnit, number>>;

const SQM_TO_SQFT = 10.7639;
const M_TO_FT = 3.28084;

/** BOQ units as typed (Sqft, Sft, Sqm, Rmt, Rft, Nos, Pair, Lsm …) → a rule unit. Unknown units count as 'nos'. */
export function normaliseUnit(raw: string): RuleUnit {
  const u = raw.trim().toLowerCase().replace(/[\s.]/g, '');
  if (['sqft', 'sft', 'sqfeet', 'ft2', 'sf'].includes(u)) return 'sqft';
  if (['sqm', 'sqmt', 'sqmtr', 'm2', 'sqmeter', 'sqmetre'].includes(u)) return 'sqm';
  if (['rmt', 'rm', 'mtr', 'm', 'meter', 'metre', 'rmtr', 'lm'].includes(u)) return 'rmt';
  if (['rft', 'ft', 'feet', 'runningfeet'].includes(u)) return 'rft';
  return 'nos';
}

/** The quantity of `q` expressed in `unit`, or null when nothing in `q` measures that way. */
export function quantityIn(q: Quantities, unit: RuleUnit): number | null {
  const has = (u: RuleUnit) => typeof q[u] === 'number' && Number.isFinite(q[u]);
  const v = (u: RuleUnit) => (has(u) ? (q[u] as number) : 0);
  switch (unit) {
    case 'sqft':
      return has('sqft') || has('sqm') ? v('sqft') + v('sqm') * SQM_TO_SQFT : null;
    case 'sqm':
      return has('sqft') || has('sqm') ? v('sqm') + v('sqft') / SQM_TO_SQFT : null;
    case 'rmt':
      return has('rmt') || has('rft') ? v('rmt') + v('rft') / M_TO_FT : null;
    case 'rft':
      return has('rmt') || has('rft') ? v('rft') + v('rmt') * M_TO_FT : null;
    case 'nos':
      return has('nos') ? v('nos') : null;
  }
}

export function addQuantity(q: Quantities, unit: RuleUnit, amount: number): Quantities {
  if (!Number.isFinite(amount) || amount <= 0) return q;
  return { ...q, [unit]: Math.round(((q[unit] ?? 0) + amount) * 100) / 100 };
}

export interface RuleResult {
  days: number;
  /** A per-qty rule whose unit the quantities don't measure: the minimum was used. */
  noQuantity: boolean;
}

/** Working days a rule gives for these quantities (always ≥ 1). */
export function ruleDays(rule: DurationRule, q: Quantities): RuleResult {
  const min = Math.max(1, Math.round(rule.minDays || 1));
  if (rule.mode === 'fixed') return { days: Math.max(1, Math.ceil(rule.days - 1e-9)), noQuantity: false };
  const qty = rule.unit ? quantityIn(q, rule.unit) : null;
  if (qty === null || !rule.perQty || rule.perQty <= 0) return { days: min, noQuantity: qty === null };
  return { days: Math.max(min, Math.ceil((qty * rule.days) / rule.perQty - 1e-9)), noQuantity: false };
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-IN') : n.toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** "Fixed · 3 d" / "1 d per 4,000 sqft · min 2" */
export function describeRule(rule: DurationRule): string {
  if (rule.mode === 'fixed') return `${fmt(rule.days)} d`;
  return `${fmt(rule.days)} d per ${fmt(rule.perQty ?? 0)} ${rule.unit ? UNIT_LABEL[rule.unit] : ''}${rule.minDays > 1 ? ` · min ${rule.minDays}` : ''}`;
}

/** "8,000 sqft · 340 rmt" */
export function describeQuantities(q: Quantities): string {
  return RULE_UNITS.filter((u) => q[u] !== undefined)
    .map((u) => `${fmt(Math.round((q[u] as number) * 100) / 100)} ${UNIT_LABEL[u]}`)
    .join(' · ');
}
