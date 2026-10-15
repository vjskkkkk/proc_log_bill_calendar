import type { IsoDate } from './dates';

/** A task's own dates: both set, or both null (migration 0002 CHECK). */
export interface DatePair {
  startDate: IsoDate | null;
  endDate: IsoDate | null;
}

/**
 * Applies an edit to a date pair and returns a valid pair. In the patch, `undefined` = not edited, `null` = cleared.
 * - Clearing the edited date clears both (the row becomes unscheduled).
 * - One date only → the other copies it (a one-day bar).
 * - End before start → the date the user did NOT edit moves to match; if both were edited, end snaps to start.
 * Shared by the date cells (instant feedback) and worker/services/tasks.ts (the authority).
 */
export function normalisePair(existing: DatePair, patch: Partial<DatePair>): DatePair {
  const editedStart = patch.startDate !== undefined;
  const editedEnd = patch.endDate !== undefined;
  let s = editedStart ? patch.startDate ?? null : existing.startDate;
  let e = editedEnd ? patch.endDate ?? null : existing.endDate;

  if ((editedStart && s === null) || (editedEnd && e === null)) {
    // Clearing one side of a scheduled row unschedules it — unless the other side was set in the same edit.
    if (editedStart && editedEnd && (s !== null || e !== null)) {
      s = s ?? e;
      e = e ?? s;
    } else {
      return { startDate: null, endDate: null };
    }
  }
  if (s === null && e !== null) s = e;
  if (e === null && s !== null) e = s;
  if (s !== null && e !== null && e < s) {
    if (editedStart && !editedEnd) e = s;
    else if (editedEnd && !editedStart) s = e;
    else e = s;
  }
  return { startDate: s, endDate: e };
}
