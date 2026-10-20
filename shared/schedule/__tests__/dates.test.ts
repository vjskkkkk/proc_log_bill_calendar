import { describe, expect, it } from 'vitest';
import { addDays, diffDays, formatLong, formatShort, isIsoDate, isSunday, istDateOf, startOfWeek, todayIST, weekday } from '../dates';
import { normalisePair } from '../pair';
import { parseDateInput } from '../parse';

describe('IST calendar days', () => {
  it('rolls over at 18:30 UTC', () => {
    expect(todayIST(Date.parse('2026-10-15T18:29:59Z'))).toBe('2026-10-15');
    expect(todayIST(Date.parse('2026-10-15T18:30:00Z'))).toBe('2026-10-16');
    expect(istDateOf('2026-12-31T20:00:00.000Z')).toBe('2027-01-01');
  });
  it('adds and diffs across month, year and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-10-01', '2026-10-15')).toBe(14);
    expect(diffDays('2026-10-15', '2026-10-01')).toBe(-14);
    expect(diffDays('2027-12-31', '2028-12-31')).toBe(366);
  });
  it('validates dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-2-3')).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
  it('knows Sundays and weeks', () => {
    expect(weekday('2026-10-15')).toBe(4); // Thursday
    expect(isSunday('2026-10-18')).toBe(true);
    expect(isSunday('2026-10-17')).toBe(false);
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
  });
  it('formats', () => {
    expect(formatShort('2026-10-05')).toBe('5 Oct');
    expect(formatLong('2026-10-15')).toBe('Thu, 15 Oct 2026');
  });
});

describe('normalisePair', () => {
  const none = { startDate: null, endDate: null };
  const set = { startDate: '2026-10-10', endDate: '2026-10-14' };
  it('copies a single date to the other side', () => {
    expect(normalisePair(none, { startDate: '2026-10-10' })).toEqual({ startDate: '2026-10-10', endDate: '2026-10-10' });
    expect(normalisePair(none, { endDate: '2026-10-12' })).toEqual({ startDate: '2026-10-12', endDate: '2026-10-12' });
  });
  it('moves the side that was not edited', () => {
    expect(normalisePair(set, { startDate: '2026-10-20' })).toEqual({ startDate: '2026-10-20', endDate: '2026-10-20' });
    expect(normalisePair(set, { endDate: '2026-10-01' })).toEqual({ startDate: '2026-10-01', endDate: '2026-10-01' });
    expect(normalisePair(set, { startDate: '2026-10-12' })).toEqual({ startDate: '2026-10-12', endDate: '2026-10-14' });
  });
  it('snaps end to start when both are edited the wrong way round', () => {
    expect(normalisePair(set, { startDate: '2026-10-20', endDate: '2026-10-18' })).toEqual({ startDate: '2026-10-20', endDate: '2026-10-20' });
  });
  it('clearing one side unschedules', () => {
    expect(normalisePair(set, { startDate: null })).toEqual(none);
    expect(normalisePair(set, { endDate: null })).toEqual(none);
    expect(normalisePair(set, { startDate: null, endDate: null })).toEqual(none);
    expect(normalisePair(set, { startDate: null, endDate: '2026-10-22' })).toEqual({ startDate: '2026-10-22', endDate: '2026-10-22' });
  });
  it('leaves untouched pairs alone', () => {
    expect(normalisePair(set, {})).toEqual(set);
    expect(normalisePair(none, {})).toEqual(none);
  });
});

describe('parseDateInput', () => {
  const ref = '2026-10-15';
  const p = (t: string, extra: object = {}) => {
    const r = parseDateInput(t, { ref, ...extra });
    return r.ok ? r.date : 'ERR';
  };
  it('reads common formats (day before month)', () => {
    expect(p('2026-11-12')).toBe('2026-11-12');
    expect(p('12/11')).toBe('2026-11-12');
    expect(p('12/11/26')).toBe('2026-11-12');
    expect(p('12-11-2027')).toBe('2027-11-12');
    expect(p('12.11')).toBe('2026-11-12');
    expect(p('12 nov')).toBe('2026-11-12');
    expect(p('12 November 2026')).toBe('2026-11-12');
    expect(p('3rd dec')).toBe('2026-12-03');
    expect(p('nov 12')).toBe('2026-11-12');
    expect(p('Nov 12, 2027')).toBe('2027-11-12');
  });
  it('infers the nearest year for year-less input', () => {
    expect(p('5 jan')).toBe('2027-01-05');
    expect(p('20 jun')).toBe('2026-06-20');
    expect(parseDateInput('28/12', { ref: '2027-01-10' })).toEqual({ ok: true, date: '2026-12-28' });
  });
  it('understands words and relative offsets', () => {
    expect(p('')).toBeNull();
    expect(p('today')).toBe(ref);
    expect(p('tomorrow')).toBe('2026-10-16');
    expect(p('+3')).toBe('2026-10-18');
    expect(p('-2')).toBe('2026-10-13');
    expect(p('+5', { plusBase: '2026-11-01', plusIsLength: true })).toBe('2026-11-06'); // working days: Sun 1 Nov → Mon–Fri
    expect(p('+7', { plusBase: '2026-11-02', plusIsLength: true })).toBe('2026-11-09');
    expect(p('+1', { plusBase: '2026-11-01', plusIsLength: true })).toBe('2026-11-01');
    expect(p('+0', { plusBase: '2026-11-01', plusIsLength: true })).toBe('ERR');
  });
  it('rejects nonsense', () => {
    expect(p('31/2')).toBe('ERR');
    expect(p('13/13')).toBe('ERR');
    expect(p('soon')).toBe('ERR');
    expect(p('12 foo')).toBe('ERR');
  });
});
