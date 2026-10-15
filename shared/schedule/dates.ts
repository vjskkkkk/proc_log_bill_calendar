/**
 * Calendar-day arithmetic on 'YYYY-MM-DD' strings. All planner dates are IST calendar days (CLAUDE.md rule 1–2);
 * a day number is the count of days since 1970-01-01, computed in UTC so no local time zone ever leaks in.
 * IST is UTC+05:30 with no DST, so "today in IST" is plain offset arithmetic.
 */
export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export function isIsoDate(s: unknown): s is IsoDate {
  if (typeof s !== 'string') return false;
  const m = ISO.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

export function toIso(year: number, month1: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Days since 1970-01-01. */
export function dayNum(d: IsoDate): number {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Not a date: ${d}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
}

export function fromDayNum(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  return fromDayNum(dayNum(d) + days);
}

/** b − a in days (positive when b is later). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return dayNum(b) - dayNum(a);
}

export function minDate(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}
export function maxDate(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}

/** The IST calendar day of an instant (default: now). */
export function todayIST(nowMs: number = Date.now()): IsoDate {
  return new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The IST calendar day of a UTC ISO timestamp (e.g. `done_at`). */
export function istDateOf(timestamp: string): IsoDate {
  return todayIST(Date.parse(timestamp));
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(d: IsoDate): number {
  return (((dayNum(d) + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function isSunday(d: IsoDate): boolean {
  return weekday(d) === 0;
}

/** The Monday on or before d. */
export function startOfWeek(d: IsoDate): IsoDate {
  return addDays(d, -((weekday(d) + 6) % 7));
}

export function parts(d: IsoDate): { year: number; month: number; day: number } {
  const m = ISO.exec(d);
  if (!m) throw new Error(`Not a date: ${d}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** "12 Oct" */
export function formatShort(d: IsoDate): string {
  const p = parts(d);
  return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** "12 Oct 2026" */
export function formatMedium(d: IsoDate): string {
  const p = parts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** "Thu, 15 Oct 2026" */
export function formatLong(d: IsoDate): string {
  return `${WEEKDAYS[weekday(d)]}, ${formatMedium(d)}`;
}
