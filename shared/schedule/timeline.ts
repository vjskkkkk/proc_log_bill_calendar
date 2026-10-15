import { addDays, diffDays, isSunday, maxDate, minDate, MONTHS, parts, startOfWeek, weekday, type IsoDate } from './dates';
import type { Span } from './spans';

export type Zoom = 'day' | 'week' | 'month';
/** Pixels per day at each zoom level. */
export const ZOOM_PX: Record<Zoom, number> = { day: 32, week: 12, month: 4 };

const MAX_DAYS = 3 * 366;

/**
 * The visible date range: from the earliest date (or today − 30) back to a Monday, to the latest date (or
 * today + 180) plus two weeks; capped at about three years.
 */
export function timelineRange(spans: Iterable<Span | null | undefined>, today: IsoDate): Span {
  let lo = addDays(today, -30);
  let hi = addDays(today, 180);
  for (const s of spans) {
    if (!s) continue;
    lo = minDate(lo, s.start);
    hi = maxDate(hi, s.end);
  }
  const start = startOfWeek(lo);
  let end = addDays(hi, 14);
  if (diffDays(start, end) > MAX_DAYS) end = addDays(start, MAX_DAYS);
  return { start, end };
}

export function dayCount(range: Span): number {
  return diffDays(range.start, range.end) + 1;
}

/** Left edge of a day's column. */
export function xOf(d: IsoDate, origin: IsoDate, px: number): number {
  return diffDays(origin, d) * px;
}

/** The day whose column contains x. */
export function dateAtX(x: number, origin: IsoDate, px: number): IsoDate {
  return addDays(origin, Math.floor(x / px));
}

export const MIN_BAR_PX = 6;

/** A bar covers whole days, end inclusive. */
export function barGeometry(span: Span, origin: IsoDate, px: number): { left: number; width: number } {
  const left = xOf(span.start, origin, px);
  const width = Math.max(MIN_BAR_PX, (diffDays(span.start, span.end) + 1) * px);
  return { left, width };
}

/** Days from the origin to the first Sunday on or after it (Sunday shading is drawn as a repeating stripe). */
export function sundayOffset(origin: IsoDate): number {
  return (7 - weekday(origin)) % 7;
}

export interface MonthSegment {
  label: string;
  start: IsoDate;
  days: number;
}

export function monthSegments(range: Span): MonthSegment[] {
  const out: MonthSegment[] = [];
  let d = range.start;
  while (d <= range.end) {
    const p = parts(d);
    const nextMonth = p.month === 12 ? `${p.year + 1}-01-01` : `${p.year}-${String(p.month + 1).padStart(2, '0')}-01`;
    const segEnd = minDate(addDays(nextMonth, -1), range.end);
    out.push({ label: `${MONTHS[p.month - 1]} ${p.year}`, start: d, days: diffDays(d, segEnd) + 1 });
    d = nextMonth;
  }
  return out;
}

/** Mondays in range (week-zoom header labels). */
export function weekStarts(range: Span): IsoDate[] {
  const out: IsoDate[] = [];
  let d = startOfWeek(range.start);
  if (d < range.start) d = addDays(d, 7);
  for (; d <= range.end; d = addDays(d, 7)) out.push(d);
  return out;
}

export { isSunday };
