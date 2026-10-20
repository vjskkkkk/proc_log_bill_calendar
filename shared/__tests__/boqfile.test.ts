import { describe, expect, it } from 'vitest';
import { gridFromPdfText, linesFromGrid, readNumber, type TextItem } from '../boqfile';

describe('reading BOQ lines from a spreadsheet grid', () => {
  // BOQ Maker's costing workbook: letterhead rows, a header with merged cells (repeated values), an area banner
  // merged across A:M, item rows, a spec row, a total row; money columns are never read.
  const grid = [
    ['Koochie Play Systems', null, null],
    ['Quotation Number', null, 'KPS/KA/2026/OCT/01B'],
    [],
    ['Sl Number', 'Sl Number', 'Area', 'Area', 'Area', 'Description', 'Description', 'Unit', 'Qty', 'Qty', 'Rate (in Rs)', 'Rate (in Rs)', 'Total Amount (in Rs)'],
    ['MULTISPORT COURT', 'MULTISPORT COURT', 'MULTISPORT COURT'],
    [1, 1, 'Multisport', null, null, 'Avalon Pro 5 (Acrylic 5 Layer System + Fibreglass Mesh)', 'Avalon Pro 5 (Acrylic 5 Layer System + Fibreglass Mesh)', 'Sqft', 7176, 7176, 120, 120, 861120],
    [null, null, null, null, null, 'Fibreglass mesh, 5 coats', null, null, null],
    [2, 2, 'Multisport', null, null, 'Solaris 200F', null, 'Nos', '10', null, 45000, null, 450000],
    [3, 3, 'Multisport', null, null, 'Hoop Pro Portable (OPTIONAL)', null, 'Pair', 1],
    [null, null, null, null, null, 'Total for A — Multisport court', null, null, null, null, null, null, 1311120],
    Array.from({ length: 13 }, () => 'PADEL COURT'), // a banner merged across A:M repeats its text in every cell
    [4, 4, 'Padel', null, null, 'Padel Pro Elite', null, 'Nos', 1, null, 2400000],
    [null, null, null, null, null, 'Grand total', null, null, null, null, null, null, 3711120],
  ];

  it('finds the header, areas, items and optional lines, and skips specs and totals', () => {
    const { lines, warnings } = linesFromGrid(grid);
    expect(warnings).toEqual([]);
    expect(lines.map((l) => [l.area, l.name, l.unit, l.qty, l.optional])).toEqual([
      ['MULTISPORT COURT', 'Avalon Pro 5 (Acrylic 5 Layer System + Fibreglass Mesh)', 'Sqft', 7176, false],
      ['MULTISPORT COURT', 'Solaris 200F', 'Nos', 10, false],
      ['MULTISPORT COURT', 'Hoop Pro Portable', 'Pair', 1, true],
      ['PADEL COURT', 'Padel Pro Elite', 'Nos', 1, false],
    ]);
    expect(JSON.stringify(lines)).not.toMatch(/861120|45000|2400000/);
  });

  it('works with a plain sheet: Item / Quantity / UOM headings, no serials', () => {
    const { lines } = linesFromGrid([
      ['Item', 'UOM', 'Quantity', 'Amount'],
      ['Verde Pitch', 'Sqft', '1,672.5', '2,00,700'],
      ['Notes only'],
    ]);
    expect(lines.map((l) => [l.name, l.unit, l.qty])).toEqual([['Verde Pitch', 'Sqft', 1672.5]]);
  });

  it('says why when nothing can be read', () => {
    expect(linesFromGrid([['Just', 'some'], ['words']]).warnings[0]).toMatch(/header row/);
    expect(linesFromGrid([['Item', 'Unit', 'Qty'], ['A note']]).warnings[0]).toMatch(/no rows under it/);
  });

  it('reads numbers with Indian grouping and rejects text', () => {
    expect([readNumber('7,176'), readNumber('1,00,000.5'), readNumber(12), readNumber('12 Nos'), readNumber('')]).toEqual([7176, 100000.5, 12, null, null]);
  });
});

describe('reading BOQ lines from PDF text', () => {
  // BOQ Maker's client PDF table: Sl | Item & specification | Unit (centred) | Qty, Rate, Amount (right-aligned).
  const T = (str: string, x: number, y: number, page = 1): TextItem => ({ str, x, y, width: str.length * 4.2, page });
  const items = [
    T('Quotation', 40, 800),
    T('Sl', 42, 700), T('Item & specification', 70, 700), T('Unit', 372, 700), T('Qty', 418, 700), T('Rate (₹)', 460, 700), T('Amount (₹)', 515, 700),
    T('A', 44, 684), T('MULTISPORT COURT', 70, 684), T('7,176 Sqft', 160, 684),
    T('1', 44, 668), T('Avalon Pro 5 (Acrylic 5 Layer System + Fibreglass', 70, 668), T('Sqft', 372, 668), T('7,176', 410, 668), T('120.00', 470, 668), T('8,61,120', 520, 668),
    T('Mesh)', 70, 657),
    T('Acrylic system, five coats on a cured base', 70, 646),
    T('2', 44, 640), T('Solaris 200F', 70, 640), T('Nos', 373, 640), T('10', 422, 640), T('45,000.00', 455, 640), T('4,50,000', 520, 640),
    T('Total for A — Multisport court', 70, 625), T('13,11,120', 515, 625),
    // Page 2 repeats the header.
    T('Sl', 42, 760, 2), T('Item & specification', 70, 760, 2), T('Unit', 372, 760, 2), T('Qty', 418, 760, 2), T('Rate (₹)', 460, 760, 2), T('Amount (₹)', 515, 760, 2),
    T('B', 44, 744, 2), T('PADEL COURT', 70, 744, 2),
    T('3', 44, 728, 2), T('Padel Pro Elite (optional)', 70, 728, 2), T('Nos', 373, 728, 2), T('1', 425, 728, 2), T('24,00,000.00', 450, 728, 2), T('24,00,000', 515, 728, 2),
  ];

  it('rebuilds columns from the header and reads items, areas and optional lines', () => {
    const { lines, warnings } = linesFromGrid(gridFromPdfText(items));
    expect(warnings).toEqual([]);
    expect(lines.map((l) => [l.area, l.name, l.unit, l.qty, l.optional])).toEqual([
      ['MULTISPORT COURT', 'Avalon Pro 5 (Acrylic 5 Layer System + Fibreglass Mesh)', 'Sqft', 7176, false],
      ['MULTISPORT COURT', 'Solaris 200F', 'Nos', 10, false],
      ['PADEL COURT', 'Padel Pro Elite', 'Nos', 1, true],
    ]);
  });
});
