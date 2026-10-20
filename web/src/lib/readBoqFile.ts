/**
 * Reads an existing BOQ file in the browser — the file never leaves this computer; only the lines found (names,
 * units, quantities) are sent when the project is created. Excel (.xlsx) and CSV become a grid of cells, a PDF its
 * positioned text; shared/boqfile.ts finds the line items in either. The two readers load only when needed.
 */
import { gridFromPdfText, linesFromGrid, type Cell, type FileLines, type TextItem } from '@shared/boqfile';

export const ACCEPTED_FILES = '.xlsx,.xlsm,.csv,.pdf';

export interface ReadFile extends FileLines {
  /** The file name without its extension (a starting project name). */
  title: string;
}

const extOf = (name: string) => name.toLowerCase().split('.').pop() ?? '';

export async function readBoqFile(file: File): Promise<ReadFile> {
  const ext = extOf(file.name);
  const title = file.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
  if (file.size > 25 * 1024 * 1024) return { title, lines: [], warnings: ['The file is over 25 MB'] };
  if (ext === 'xls') return { title, lines: [], warnings: ['Old .xls files can’t be read: open it in Excel and save it as .xlsx'] };
  if (ext === 'xlsx' || ext === 'xlsm') return { title, ...(await readExcel(file)) };
  if (ext === 'csv') return { title, ...linesFromGrid(parseCsv(await file.text())) };
  if (ext === 'pdf') return { title, ...(await readPdf(file)) };
  return { title, lines: [], warnings: ['Choose an Excel (.xlsx), CSV or PDF file'] };
}

async function readExcel(file: File): Promise<FileLines> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  let firstWarnings: string[] = [];
  // The first sheet that has line items wins (a costing workbook also has a team-expenses sheet).
  for (const ws of wb.worksheets) {
    const grid: Cell[][] = [];
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: Cell[] = [];
      for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        cells.push(typeof v === 'number' ? v : v && typeof v === 'object' && 'result' in v && typeof v.result === 'number' ? v.result : cell.text);
      }
      grid.push(cells);
    }
    const found = linesFromGrid(grid, `${ws.id}-`);
    if (found.lines.length) return found;
    if (!firstWarnings.length) firstWarnings = found.warnings.map((w) => `${ws.name}: ${w}`);
  }
  return { lines: [], warnings: firstWarnings.length ? firstWarnings : ['The workbook has no sheets'] };
}

async function readPdf(file: File): Promise<FileLines> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const items: TextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width, page: p });
    }
  }
  await task.destroy();
  if (!items.length) return { lines: [], warnings: ['This PDF has no text to read (it may be a scan or a photo): use the Excel file instead'] };
  return linesFromGrid(gridFromPdfText(items), 'p');
}

/** Minimal CSV: commas, quoted fields with "" escapes, CRLF or LF. */
export function parseCsv(src: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
