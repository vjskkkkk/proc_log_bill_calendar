import { describe, expect, it } from 'vitest';
import { addWorkingDays, endAfter, nextWorkingDay, rollForward, workingDays, workingOffset } from '../workdays';
import { addQuantity, describeRule, normaliseUnit, quantityIn, ruleDays, type DurationRule } from '../rules';

// 2026-10-18 and 2026-10-25 are Sundays.
describe('working days (Sundays off)', () => {
  it('rolls Sundays forward and steps over them', () => {
    expect(rollForward('2026-10-18')).toBe('2026-10-19');
    expect(rollForward('2026-10-17')).toBe('2026-10-17');
    expect(nextWorkingDay('2026-10-17')).toBe('2026-10-19'); // Sat → Mon
    expect(nextWorkingDay('2026-10-19')).toBe('2026-10-20');
    expect(addWorkingDays('2026-10-17', 1)).toBe('2026-10-19');
    expect(addWorkingDays('2026-10-18', 0)).toBe('2026-10-19');
    expect(addWorkingDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('counts working days in a window', () => {
    expect(workingDays('2026-10-19', '2026-10-24')).toBe(6); // Mon–Sat
    expect(workingDays('2026-10-19', '2026-10-25')).toBe(6); // + Sunday
    expect(workingDays('2026-10-19', '2026-10-26')).toBe(7);
    expect(workingDays('2026-10-18', '2026-10-18')).toBe(1); // a Sunday-only bar still counts as one
    expect(workingDays('2026-10-01', '2026-10-31')).toBe(27);
  });

  it('ends a bar after n working days, and measures offsets', () => {
    expect(endAfter('2026-10-19', 1)).toBe('2026-10-19');
    expect(endAfter('2026-10-19', 6)).toBe('2026-10-24');
    expect(endAfter('2026-10-19', 7)).toBe('2026-10-26');
    expect(endAfter('2026-10-23', 3)).toBe('2026-10-26'); // Fri, Sat, (Sun), Mon
    expect(workingOffset('2026-10-19', '2026-10-19')).toBe(0);
    expect(workingOffset('2026-10-24', '2026-10-26')).toBe(1);
    expect(workingOffset('2026-10-19', '2026-10-26')).toBe(6);
  });
});

describe('duration rules', () => {
  const perQty = (days: number, perQty: number, unit: DurationRule['unit'], minDays = 1): DurationRule => ({ mode: 'per_qty', days, perQty, unit, minDays });

  it('reads BOQ units', () => {
    expect(['Sqft', 'Sft', 'sq.ft', 'Sq ft'].map(normaliseUnit)).toEqual(['sqft', 'sqft', 'sqft', 'sqft']);
    expect(['Sqm', 'Rmt', 'Rft', 'Nos', 'Pair', 'Lsm'].map(normaliseUnit)).toEqual(['sqm', 'rmt', 'rft', 'nos', 'nos', 'nos']);
  });

  it('converts between area and length units', () => {
    const q = addQuantity(addQuantity({}, 'sqft', 1000), 'sqm', 100);
    expect(quantityIn(q, 'sqft')).toBeCloseTo(2076.39, 1);
    expect(quantityIn(q, 'rmt')).toBeNull();
    expect(quantityIn({ rft: 328.084 }, 'rmt')).toBeCloseTo(100, 3);
  });

  it('gives fixed days whatever the quantity', () => {
    expect(ruleDays({ mode: 'fixed', days: 3, perQty: null, unit: null, minDays: 1 }, { sqft: 99999 })).toEqual({ days: 3, noQuantity: false });
    expect(ruleDays({ mode: 'fixed', days: 0.5, perQty: null, unit: null, minDays: 1 }, {}).days).toBe(1);
  });

  it('scales per-qty days, rounding up, never under the minimum', () => {
    const turf = perQty(1, 4000, 'sqft', 2);
    expect(ruleDays(turf, { sqft: 2000 }).days).toBe(2);
    expect(ruleDays(turf, { sqft: 18000 }).days).toBe(5);
    expect(ruleDays(turf, { sqft: 16000 }).days).toBe(4);
    expect(ruleDays(turf, { sqm: 1000 }).days).toBe(3); // 10,764 sqft
    expect(ruleDays(perQty(2, 1, 'nos'), { nos: 3 }).days).toBe(6);
  });

  it('falls back to the minimum when the quantity is in another unit', () => {
    expect(ruleDays(perQty(1, 100, 'rmt', 2), { sqft: 5000 })).toEqual({ days: 2, noQuantity: true });
  });

  it('describes rules', () => {
    expect(describeRule({ mode: 'fixed', days: 3, perQty: null, unit: null, minDays: 1 })).toBe('3 d');
    expect(describeRule(perQty(1, 4000, 'sqft', 2))).toBe('1 d per 4,000 sqft · min 2');
  });
});
