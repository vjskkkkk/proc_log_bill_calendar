/** Fixed geometry of the planner grid (px). Rows have one height so virtualisation is plain arithmetic. */
export const ROW_H = 32;
export const HEADER_H = 48;
/** Rows rendered above and below the viewport. */
export const OVERSCAN = 20;

export type ColKey = 'grip' | 'title' | 'cat' | 'owner' | 'start' | 'end' | 'days' | 'dep' | 'done';
export interface Col {
  key: ColKey;
  label: string;
  w: number;
}

const FULL: Col[] = [
  { key: 'grip', label: '', w: 44 },
  { key: 'title', label: 'Task / sub-task', w: 300 },
  { key: 'cat', label: 'Category', w: 112 },
  { key: 'owner', label: 'Owner', w: 120 },
  { key: 'start', label: 'Start', w: 84 },
  { key: 'end', label: 'End', w: 84 },
  { key: 'days', label: 'Days', w: 46 },
  { key: 'dep', label: 'Waits for', w: 140 },
  { key: 'done', label: '✓', w: 36 },
];
const COMPACT: ColKey[] = ['grip', 'title', 'start', 'end', 'done'];

export function columns(compact: boolean): Col[] {
  return compact ? FULL.filter((c) => COMPACT.includes(c.key)).map((c) => (c.key === 'title' ? { ...c, w: 260 } : c)) : FULL;
}

export function leftWidth(cols: Col[]): number {
  return cols.reduce((s, c) => s + c.w, 0);
}

/** Focusable cell id: `${rowKey}|${col}` (rows are keyed, not indexed, so inserts do not move focus). */
export const cellId = (rowKey: string, col: ColKey) => `${rowKey}|${col}`;
