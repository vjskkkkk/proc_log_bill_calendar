import { addDays, dayNum, isIsoDate, MONTHS, toIso, type IsoDate } from './dates';

export interface ParseOptions {
  /** Year-less input resolves to the date nearest this one (within ±6 months). Usually today. */
  ref: IsoDate;
  /** Base for "+N"/"-N". End cells pass the row's start date with `plusIsLength`, so "+5" = five days long. */
  plusBase?: IsoDate | null;
  plusIsLength?: boolean;
}

export type ParseResult = { ok: true; date: IsoDate | null } | { ok: false };

const MONTH_INDEX: Record<string, number> = Object.fromEntries(MONTHS.map((m, i) => [m.toLowerCase(), i + 1]));

function monthOf(word: string): number | null {
  const w = word.toLowerCase().slice(0, 3);
  return MONTH_INDEX[w] ?? null;
}

function year4(y: string): number {
  const n = Number(y);
  return y.length <= 2 ? 2000 + n : n;
}

/** Picks the year for day/month so the date lands within ±6 months of ref. */
function nearestYear(day: number, month: number, ref: IsoDate): IsoDate | null {
  const refYear = Number(ref.slice(0, 4));
  let best: IsoDate | null = null;
  let bestGap = Infinity;
  for (const y of [refYear - 1, refYear, refYear + 1]) {
    const iso = toIso(y, month, day);
    if (!isIsoDate(iso)) continue;
    const gap = Math.abs(dayNum(iso) - dayNum(ref));
    if (gap < bestGap) {
      best = iso;
      bestGap = gap;
    }
  }
  return best;
}

function build(day: number, month: number, year: number | null, ref: IsoDate): IsoDate | null {
  if (year === null) return nearestYear(day, month, ref);
  const iso = toIso(year, month, day);
  return isIsoDate(iso) ? iso : null;
}

/**
 * Reads what a person types into a date cell. Accepts '' (clear), 2026-11-12, 12/11, 12/11/26, 12-11-2026, 12.11,
 * "12 nov", "12 nov 26", "nov 12", "today", "tomorrow", "+N"/"-N". Day comes before month (India).
 */
export function parseDateInput(text: string, opts: ParseOptions): ParseResult {
  const t = text.trim().toLowerCase();
  if (t === '') return { ok: true, date: null };
  if (t === 'today' || t === 'tod' || t === 't') return { ok: true, date: opts.ref };
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return { ok: true, date: addDays(opts.ref, 1) };
  if (t === 'yesterday') return { ok: true, date: addDays(opts.ref, -1) };

  const rel = /^([+-])\s*(\d{1,4})$/.exec(t);
  if (rel) {
    const n = Number(rel[2]) * (rel[1] === '-' ? -1 : 1);
    if (opts.plusBase && opts.plusIsLength) {
      if (n < 1) return { ok: false };
      return { ok: true, date: addDays(opts.plusBase, n - 1) };
    }
    return { ok: true, date: addDays(opts.plusBase ?? opts.ref, n) };
  }

  if (isIsoDate(t)) return { ok: true, date: t };

  let m = /^(\d{1,2})\s*[/.\-]\s*(\d{1,2})(?:\s*[/.\-]\s*(\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const date = build(Number(m[1]), Number(m[2]), m[3] ? year4(m[3]) : null, opts.ref);
    return date ? { ok: true, date } : { ok: false };
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s*[\s\-/]?\s*([a-z]{3,9})\.?(?:\s*[\s,\-/]\s*(\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const month = monthOf(m[2]!);
    if (!month) return { ok: false };
    const date = build(Number(m[1]), month, m[3] ? year4(m[3]) : null, opts.ref);
    return date ? { ok: true, date } : { ok: false };
  }
  m = /^([a-z]{3,9})\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const month = monthOf(m[1]!);
    if (!month) return { ok: false };
    const date = build(Number(m[2]), month, m[3] ? year4(m[3]) : null, opts.ref);
    return date ? { ok: true, date } : { ok: false };
  }
  return { ok: false };
}
