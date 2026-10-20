/**
 * Reading BOQ line items out of an existing file (docs/PLAN.md "Import from a file"): a spreadsheet's cells or a
 * PDF's positioned text become a grid of rows, the header row (Unit + Qty + an item/description column) says which
 * column is which, and every row below it with a description, a unit and a quantity becomes a line. Rows with text
 * only in the first column (a letter, or a banner) name the area the following lines belong to; description-only
 * rows (specifications) and total rows are skipped. Rates and amounts are never read.
 *
 * Pure: the browser turns the file into cells (web/src/lib/readBoqFile.ts) and calls these.
 */
import type { QuoteLine } from './schedule/import';

export type Cell = string | number | null | undefined;

export interface FileLines {
  lines: QuoteLine[];
  /** Why nothing (or something odd) was found, for the person importing. */
  warnings: string[];
}

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c)).replace(/\s+/g, ' ').trim();

/** "7,176", "1,234.5", 12 → number; anything else → null. */
export function readNumber(c: Cell): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = text(c).replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

const HEAD = {
  qty: /^(qty|quantity|qnty|quan)\b/i,
  unit: /^(unit|uom|units)\b/i,
  desc: /(item|description|particular|specification|product|work|material)/i,
  sl: /^(sl|s\.?\s?no|sr|serial|#|no\.?$)/i,
};
const TOTAL = /^(sub\s*-?\s*)?total\b|grand total|net amount|amount in words/i;
const OPTIONAL = /\s*\((optional)\)\s*$/i;

/** A name cut off mid-way: an unclosed bracket, or ending in a joining character. */
function unfinished(name: string): boolean {
  const open = (name.match(/[([]/g) ?? []).length;
  const close = (name.match(/[)\]]/g) ?? []).length;
  return open > close || /[+&,/(-]\s*$/.test(name);
}

interface Columns {
  sl: number | null;
  desc: number;
  unit: number;
  qty: number;
}

/** The header row and its columns: first row (of the first 80) that has Unit and Qty and a description column. */
export function findHeader(rows: Cell[][]): { row: number; cols: Columns } | null {
  for (let r = 0; r < Math.min(rows.length, 80); r++) {
    const cells = rows[r]!.map(text);
    const qty = cells.findIndex((c) => HEAD.qty.test(c));
    const unit = cells.findIndex((c) => HEAD.unit.test(c));
    if (qty < 0 || unit < 0) continue;
    let desc = cells.findIndex((c, i) => i !== qty && i !== unit && HEAD.desc.test(c));
    if (desc < 0) {
      // No description title: the nearest titled column left of Unit.
      for (let i = Math.min(unit, qty) - 1; i >= 0; i--) if (cells[i]) { desc = i; break; }
    }
    if (desc < 0) continue;
    const sl = cells.findIndex((c, i) => i < desc && HEAD.sl.test(c));
    return { row: r, cols: { sl: sl < 0 ? null : sl, desc, unit, qty } };
  }
  return null;
}

/** Lines from rows of cells (a sheet, or a PDF page rebuilt into columns). */
export function linesFromGrid(rows: Cell[][], idPrefix = 'f'): FileLines {
  const head = findHeader(rows);
  if (!head) return { lines: [], warnings: ['No header row with “Unit” and “Qty” columns was found'] };
  const { cols } = head;
  const lines: QuoteLine[] = [];
  let area = '';
  let lastItemRow = -1;
  for (let r = head.row + 1; r < rows.length; r++) {
    const row = rows[r]!;
    const cells = row.map(text);
    const filled = cells.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    if (!filled.length) continue;
    // A repeated header (each PDF page has one).
    if (HEAD.qty.test(cells[cols.qty] ?? '') && HEAD.unit.test(cells[cols.unit] ?? '')) continue;
    const descText = cells[cols.desc] ?? '';
    if (TOTAL.test(descText) || filled.some((i) => TOTAL.test(cells[i]!))) continue;
    const qty = readNumber(row[cols.qty]);
    const unit = cells[cols.unit] ?? '';
    if (qty !== null && descText && unit && !/^\d/.test(unit)) {
      const optional = OPTIONAL.test(descText);
      lines.push({
        id: `${idPrefix}${lines.length + 1}`,
        area,
        sport: '',
        code: '',
        name: descText.replace(OPTIONAL, '').trim(),
        unit,
        qty,
        optional,
        category: '',
        subCategory: '',
      });
      lastItemRow = r;
      continue;
    }
    const sl = cols.sl !== null ? cells[cols.sl] ?? '' : '';
    // A name that runs onto the next line (a PDF cell wraps): join it while the name is clearly unfinished.
    const last = lines[lines.length - 1];
    if (last && qty === null && descText && !sl && filled.every((i) => i === cols.desc) && unfinished(last.name) && r === lastItemRow + 1) {
      last.name = `${last.name} ${descText}`.replace(OPTIONAL, '').trim();
      lastItemRow = r;
      continue;
    }
    // Area banner: text in the first columns only, or one text across the whole row (a merged Excel banner), or a
    // letter in the Sl column with a name (PDF).
    const sameText = filled.length > 1 && filled.every((i) => cells[i] === cells[filled[0]!]);
    const bannerText = filled.every((i) => i < cols.desc) || sameText ? cells[filled[0]!]! : /^[A-Z]$/.test(sl) && descText ? descText : '';
    if (bannerText && qty === null) area = bannerText.replace(/\s+[\d,]+(\.\d+)?\s*(sq\.?\s*ft|sqft|sqm)\s*$/i, '').trim();
  }
  const warnings = lines.length ? [] : ['A header row was found, but no rows under it had an item, a unit and a quantity'];
  return { lines, warnings };
}

/** A piece of PDF text with its position (PDF units; y grows upwards, as pdf.js reports it). */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  page: number;
}

/**
 * Rebuilds a PDF's text into rows of cells: items on (nearly) the same baseline make a row. The header row (on each
 * page; later pages without one reuse the last) sets the columns: the border between two columns is midway between
 * the end of one heading and the start of the next, and each piece of text goes where its centre falls — so left-
 * aligned names and right-aligned numbers both land in their own column.
 */
export function gridFromPdfText(items: TextItem[]): Cell[][] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const out: Cell[][] = [];
  let borders: number[] | null = null;
  for (const p of pages) {
    const lines = groupLines(items.filter((i) => i.page === p && i.str.trim()));
    for (const line of lines) {
      const cells = line.map((i) => i.str.trim());
      if (cells.some((c) => HEAD.qty.test(c)) && cells.some((c) => HEAD.unit.test(c))) {
        borders = line.slice(1).map((it, k) => (line[k]!.x + line[k]!.width + it.x) / 2);
      }
      if (!borders) {
        out.push([cells.join(' ')]);
        continue;
      }
      const row: string[] = Array.from({ length: borders.length + 1 }, () => '');
      for (const it of line) {
        const centre = it.x + it.width / 2;
        const col = borders.filter((b) => centre >= b).length;
        row[col] = row[col] ? `${row[col]} ${it.str.trim()}` : it.str.trim();
      }
      out.push(row);
    }
  }
  return out;
}

function groupLines(items: TextItem[]): TextItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItem[][] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0]!.y - it.y) <= 2.5) last.push(it);
    else lines.push([it]);
  }
  // Merge pieces of one cell (pdf.js splits runs of text) when they nearly touch.
  return lines.map((l) => {
    const byX = l.sort((a, b) => a.x - b.x);
    const merged: TextItem[] = [];
    for (const it of byX) {
      const prev = merged[merged.length - 1];
      if (prev && it.x - (prev.x + prev.width) < 3) merged[merged.length - 1] = { ...prev, str: `${prev.str}${it.str.startsWith(' ') || prev.str.endsWith(' ') ? '' : ' '}${it.str}`.replace(/\s+/g, ' '), width: it.x + it.width - prev.x };
      else merged.push({ ...it });
    }
    return merged;
  });
}
