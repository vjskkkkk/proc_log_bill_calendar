import { describe, expect, it } from 'vitest';
import { buildImportPlan, defaultChoices, matchLine, type ListItem, type QuoteLine } from '../import';
import type { DurationRule } from '../rules';

const fixed = (days: number): DurationRule => ({ mode: 'fixed', days, perQty: null, unit: null, minDays: 1 });
const perQty = (days: number, perQty: number, unit: DurationRule['unit'], minDays = 1): DurationRule => ({ mode: 'per_qty', days, perQty, unit, minDays });
const item = (p: Partial<ListItem> & { id: string; name: string }): ListItem => ({ category: 'material', parentId: null, sortOrder: 1, rule: fixed(1), dependsOnId: null, boqMatch: [], autoAdd: false, ...p });
const line = (p: Partial<QuoteLine> & { id: string; name: string }): QuoteLine => ({ area: 'Court 1', sport: '', code: '', unit: 'Sqft', qty: 1, optional: false, category: '', subCategory: '', ...p });

const items: ListItem[] = [
  item({ id: 'turf', name: 'Artificial turf', boqMatch: ['verde', 'kryoturf'] }),
  item({ id: 'turf-po', parentId: 'turf', name: 'Raise PO', sortOrder: 1, rule: fixed(1) }),
  item({ id: 'turf-make', parentId: 'turf', name: 'Production', sortOrder: 2, rule: perQty(1, 5000, 'sqft', 10), dependsOnId: 'turf-po' }),
  item({ id: 'lay', category: 'installation', name: 'Turf installation', boqMatch: ['verde'], dependsOnId: 'turf' }),
  item({ id: 'lay-roll', category: 'installation', parentId: 'lay', name: 'Lay & seam turf', sortOrder: 1, rule: perQty(1, 4000, 'sqft', 2) }),
  item({ id: 'lay-infill', category: 'installation', parentId: 'lay', name: 'Infill', sortOrder: 2, rule: fixed(1), dependsOnId: 'lay-roll' }),
  item({ id: 'lights', category: 'equipment', name: 'Floodlights', boqMatch: ['SOLARIS-200F'], rule: perQty(1, 10, 'nos', 3) }),
  item({ id: 'invoice', category: 'billing', name: 'Advance invoice', autoAdd: true, rule: fixed(2) }),
];

describe('matching quote lines to the Task List', () => {
  it('matches on name words and exact codes, in Task List order', () => {
    expect(matchLine({ name: 'Verde Arena', code: 'VERDE-ARENA' }, items)).toEqual(['turf', 'lay']);
    expect(matchLine({ name: 'Floodlight 200W', code: 'SOLARIS-200F' }, items)).toEqual(['lights']);
    expect(matchLine({ name: 'Mystery item', code: '' }, items)).toEqual([]);
  });

  it('skips optional lines by default', () => {
    const ch = defaultChoices([line({ id: 'l1', name: 'Verde Pitch' }), line({ id: 'l2', name: 'Verde Pitch', optional: true })], items);
    expect(ch.map((c) => c.include)).toEqual([true, false]);
  });
});

describe('buildImportPlan', () => {
  const lines = [
    line({ id: 'l1', name: 'Verde Arena', qty: 6000, area: 'Court 1' }),
    line({ id: 'l2', name: 'Verde Arena', qty: 1000, unit: 'Sqm', area: 'Court 2' }), // 10,764 sqft
    line({ id: 'l3', name: 'Solaris 200F', code: 'SOLARIS-200F', qty: 12, unit: 'Nos' }),
    line({ id: 'l4', name: 'Shed', qty: 1, unit: 'Lsm' }),
  ];
  const plan = (extra: Partial<Parameters<typeof buildImportPlan>[0]> = {}) =>
    buildImportPlan({ lines, choices: defaultChoices(lines, items), items, extraTemplateIds: ['invoice'], startDate: '2026-10-18', quoteLabel: 'KS/26/001', ...extra });
  const byTitle = (p: ReturnType<typeof plan>) => Object.fromEntries(p.map((t) => [t.title, t]));

  it('makes one task per Task List entry with summed quantities and its steps', () => {
    const p = plan();
    expect(p.filter((t) => !t.parentKey).map((t) => t.title)).toEqual(['Artificial turf', 'Floodlights', 'Turf installation', 'Advance invoice']);
    const turf = byTitle(p)['Artificial turf']!;
    expect(turf.quantities.sqft).toBe(6000);
    expect(turf.quantities.sqm).toBe(1000);
    expect(turf.notes).toContain('Verde Arena — 1,000 sqm (Court 2)');
    expect(p.filter((t) => t.parentKey === turf.key).map((t) => t.title)).toEqual(['Raise PO', 'Production']);
  });

  it('sets planned days from the rules and dates from the dependencies', () => {
    const t = byTitle(plan());
    // Start is a Sunday → work starts Monday 19 Oct.
    expect(t['Raise PO']).toMatchObject({ plannedDays: 1, startDate: '2026-10-19', endDate: '2026-10-19' });
    expect(t['Production']).toMatchObject({ plannedDays: 10, startDate: '2026-10-20', endDate: '2026-10-30' }); // 16,764 sqft → 4 d, min 10
    // Installation waits for the turf task to finish, then lays 16,764 sqft at 4,000 a day.
    expect(t['Lay & seam turf']).toMatchObject({ plannedDays: 5, startDate: '2026-10-31', endDate: '2026-11-05' });
    expect(t['Infill']).toMatchObject({ startDate: '2026-11-06', endDate: '2026-11-06' });
    expect(t['Turf installation']).toMatchObject({ startDate: null, endDate: null, plannedDays: null });
    expect(t['Floodlights']).toMatchObject({ plannedDays: 3, startDate: '2026-10-19', endDate: '2026-10-21' }); // 12 nos → 2 d, min 3
    expect(t['Advance invoice']).toMatchObject({ plannedDays: 2, notes: '' });
  });

  it('adds a one-off task for an unmatched line, and drops skipped lines', () => {
    const choices = defaultChoices(lines, items).map((c) =>
      c.lineId === 'l4' ? { ...c, custom: { name: 'Site shed', category: 'logistics', rule: fixed(2) } } : c.lineId === 'l3' ? { ...c, include: false } : c,
    );
    const t = byTitle(plan({ choices, extraTemplateIds: [] }));
    expect(t['Floodlights']).toBeUndefined();
    expect(t['Site shed']).toMatchObject({ catalogItemId: null, category: 'logistics', plannedDays: 2, startDate: '2026-10-19', endDate: '2026-10-20' });
  });

  it('puts always-added site work that waits for nothing (handover) after the site work that ends last', () => {
    const withHandover = [...items, item({ id: 'handover', category: 'installation', name: 'Site handover', autoAdd: true, rule: fixed(1) })];
    const p = buildImportPlan({ lines, choices: defaultChoices(lines, withHandover), items: withHandover, extraTemplateIds: ['handover'], startDate: '2026-10-19', quoteLabel: 'Q' });
    const t = Object.fromEntries(p.map((x) => [x.title, x]));
    expect(t['Site handover']).toMatchObject({ dependsOnKey: 't:lay', startDate: '2026-11-07', endDate: '2026-11-07' }); // Infill ends Fri 6 Nov
  });

  it('flags a per-qty rule that found no quantity in its unit', () => {
    const odd = [line({ id: 'x', name: 'Solaris 200F', code: 'SOLARIS-200F', qty: 500, unit: 'Sqft' })];
    const p = buildImportPlan({ lines: odd, choices: defaultChoices(odd, items), items, extraTemplateIds: [], startDate: '2026-10-19', quoteLabel: 'Q' });
    expect(p[0]).toMatchObject({ title: 'Floodlights', plannedDays: 3, noQuantity: true });
  });
});
