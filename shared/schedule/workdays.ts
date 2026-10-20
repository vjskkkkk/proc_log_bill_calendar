/**
 * Working-day arithmetic. Sundays are the only non-working day (docs/PLAN.md "Decisions"), so durations from the Task
 * Lists, dependency gaps and the Days column all count Monday–Saturday only.
 */
import { addDays, diffDays, isSunday, type IsoDate } from './dates';

export function isWorkingDay(d: IsoDate): boolean {
  return !isSunday(d);
}

/** d itself on a working day, else the next working day. */
export function rollForward(d: IsoDate): IsoDate {
  return isWorkingDay(d) ? d : addDays(d, 1);
}

/** The first working day after d. */
export function nextWorkingDay(d: IsoDate): IsoDate {
  return rollForward(addDays(d, 1));
}

/** n ≥ 0 working days after d (rolled forward first): addWorkingDays(Sat, 1) = Mon. */
export function addWorkingDays(d: IsoDate, n: number): IsoDate {
  let x = rollForward(d);
  for (let i = 0; i < n; i++) x = nextWorkingDay(x);
  return x;
}

/** Working days in [start, end] (at least 1, so a Sunday-only bar still counts as one day of work). */
export function workingDays(start: IsoDate, end: IsoDate): number {
  const span = diffDays(start, end) + 1;
  if (span <= 0) return 1;
  const full = Math.floor(span / 7) * 6;
  let rest = 0;
  for (let i = Math.floor(span / 7) * 7; i < span; i++) if (isWorkingDay(addDays(start, i))) rest++;
  return Math.max(1, full + rest);
}

/** Working days from a to b, a ≤ b: how far b's working day is past a's (0 when both roll to the same day). */
export function workingOffset(a: IsoDate, b: IsoDate): number {
  const ra = rollForward(a);
  const rb = rollForward(b);
  if (rb <= ra) return 0;
  return workingDays(ra, rb) - 1;
}

/** The end of a bar that starts on `start` and lasts `days` working days. */
export function endAfter(start: IsoDate, days: number): IsoDate {
  return addWorkingDays(start, Math.max(1, Math.round(days)) - 1);
}
