/**
 * Drafting a project's Gantt from a BOQ quote (docs/PLAN.md "Import from a quote").
 *
 * 1. Each quote line is matched to Task List tasks by their BOQ-match words (a word matches when the line's name
 *    contains it, or it equals the line's code). One line can feed several tasks (buy the turf, lay the turf).
 * 2. Lines that feed the same Task List task are added together by unit: one task per Task List entry.
 * 3. Each task gets its standard sub-tasks; every item's planned days come from its duration rule and the quantities.
 * 4. Independent items start on the start date; dependent ones follow what they depend on (deps.ts `propagate`).
 *
 * Pure: the browser runs it for the preview, the Worker runs it again to write the rows.
 */
import { CATEGORIES } from '../categories';
import type { IsoDate } from './dates';
import { propagate, type SchedTask } from './deps';
import { addQuantity, describeQuantities, normaliseUnit, ruleDays, type DurationRule, type Quantities } from './rules';
import { endAfter, rollForward } from './workdays';

export interface QuoteLine {
  id: string;
  area: string;
  sport: string;
  code: string;
  name: string;
  unit: string;
  qty: number;
  optional: boolean;
  category: string;
  subCategory: string;
}

/** A Task List entry as the import needs it (CatalogItemDto satisfies it). */
export interface ListItem {
  id: string;
  category: string;
  parentId: string | null;
  name: string;
  sortOrder: number;
  rule: DurationRule;
  dependsOnId: string | null;
  boqMatch: string[];
  autoAdd: boolean;
}

/** What to do with one quote line: skip it, feed Task List tasks, and/or add a one-off task for it. */
export interface LineChoice {
  lineId: string;
  include: boolean;
  templateIds: string[];
  custom?: { name: string; category: string; rule: DurationRule } | null;
}

export interface PlannedTask {
  key: string;
  parentKey: string | null;
  title: string;
  category: string;
  catalogItemId: string | null;
  plannedDays: number | null;
  dependsOnKey: string | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  quantities: Quantities;
  notes: string;
  /** A per-qty rule found no quantity in its unit and used its minimum. */
  noQuantity: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Task List tasks (not sub-tasks) whose BOQ-match words fit this line, in Task List order. */
export function matchLine(line: Pick<QuoteLine, 'name' | 'code'>, items: ListItem[]): string[] {
  const name = norm(line.name);
  const code = norm(line.code);
  return items
    .filter((i) => !i.parentId && i.boqMatch.some((w) => (w = norm(w)) && (name.includes(w) || (!!code && code === w))))
    .sort(listOrder)
    .map((i) => i.id);
}

function listOrder(a: Pick<ListItem, 'category' | 'sortOrder' | 'name'>, b: Pick<ListItem, 'category' | 'sortOrder' | 'name'>): number {
  const ca = (CATEGORIES as readonly string[]).indexOf(a.category);
  const cb = (CATEGORIES as readonly string[]).indexOf(b.category);
  return ca - cb || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
}

/** The default choice for each line: optional lines skipped, the rest feeding every Task List task they match. */
export function defaultChoices(lines: QuoteLine[], items: ListItem[]): LineChoice[] {
  return lines.map((l) => ({ lineId: l.id, include: !l.optional, templateIds: matchLine(l, items), custom: null }));
}

const lineText = (l: QuoteLine) => `• ${l.name} — ${describeQuantities(addQuantity({}, normaliseUnit(l.unit), l.qty)) || `${l.qty} ${l.unit}`}${l.area ? ` (${l.area})` : ''}`;

export interface ImportInput {
  lines: QuoteLine[];
  choices: LineChoice[];
  items: ListItem[];
  /** Task List tasks added without a quote line (auto-add ones the user kept, e.g. invoices, team travel). */
  extraTemplateIds: string[];
  startDate: IsoDate;
  quoteLabel: string;
}

export function buildImportPlan(input: ImportInput): PlannedTask[] {
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const lines = new Map(input.lines.map((l) => [l.id, l]));
  type Group = { template: ListItem; custom: boolean; quantities: Quantities; lines: QuoteLine[] };
  const groups = new Map<string, Group>();
  const group = (key: string, template: ListItem, custom: boolean) => groups.get(key) ?? groups.set(key, { template, custom, quantities: {}, lines: [] }).get(key)!;

  for (const c of input.choices) {
    const line = lines.get(c.lineId);
    if (!line || !c.include) continue;
    const feed = (g: Group) => {
      g.quantities = addQuantity(g.quantities, normaliseUnit(line.unit), line.qty);
      g.lines.push(line);
    };
    for (const tid of new Set(c.templateIds)) {
      const t = byId.get(tid);
      if (t && !t.parentId) feed(group(`t:${t.id}`, t, false));
    }
    if (c.custom?.name.trim()) {
      const name = c.custom.name.trim();
      const tmpl: ListItem = { id: '', category: c.custom.category, parentId: null, name, sortOrder: 1e6, rule: c.custom.rule, dependsOnId: null, boqMatch: [], autoAdd: false };
      feed(group(`c:${norm(name)}|${c.custom.category}`, tmpl, true));
    }
  }
  for (const tid of input.extraTemplateIds) {
    const t = byId.get(tid);
    if (t && !t.parentId) group(`t:${t.id}`, t, false);
  }

  const ordered = [...groups.entries()].sort(([, a], [, b]) => listOrder(a.template, b.template));
  const present = new Set(ordered.map(([k]) => k));
  const start = rollForward(input.startDate);
  const out: PlannedTask[] = [];

  for (const [key, g] of ordered) {
    const t = g.template;
    const steps = g.custom ? [] : input.items.filter((i) => i.parentId === t.id).sort((a, b) => a.sortOrder - b.sortOrder);
    const own = ruleDays(t.rule, g.quantities);
    const depKey = t.dependsOnId && present.has(`t:${t.dependsOnId}`) ? `t:${t.dependsOnId}` : null;
    const notes = g.lines.length ? [`From ${input.quoteLabel}:`, ...g.lines.map(lineText)].join('\n') : '';
    out.push({
      key,
      parentKey: null,
      title: t.name,
      category: t.category,
      catalogItemId: g.custom ? null : t.id,
      plannedDays: steps.length ? null : own.days,
      dependsOnKey: depKey,
      startDate: steps.length || depKey ? null : start,
      endDate: steps.length || depKey ? null : endAfter(start, own.days),
      quantities: g.quantities,
      notes,
      noQuantity: !steps.length && own.noQuantity,
    });
    const stepIds = new Set(steps.map((s) => s.id));
    for (const s of steps) {
      const r = ruleDays(s.rule, g.quantities);
      const dep = s.dependsOnId && stepIds.has(s.dependsOnId) ? `${key}/${s.dependsOnId}` : null;
      out.push({
        key: `${key}/${s.id}`,
        parentKey: key,
        title: s.name,
        category: t.category,
        catalogItemId: s.id,
        plannedDays: r.days,
        dependsOnKey: dep,
        startDate: dep ? null : start,
        endDate: dep ? null : endAfter(start, r.days),
        quantities: {},
        notes: '',
        noQuantity: r.noQuantity,
      });
    }
  }

  const schedule = (tasks: PlannedTask[]) => {
    const sched: SchedTask[] = tasks.map((p) => ({ id: p.key, projectId: 'import', parentId: p.parentKey, startDate: p.startDate, endDate: p.endDate, dependsOnId: p.dependsOnKey, plannedDays: p.plannedDays }));
    const moved = new Map(propagate(sched).map((c) => [c.id, c]));
    return tasks.map((p) => {
      const m = moved.get(p.key);
      return m ? { ...p, startDate: m.startDate, endDate: m.endDate } : p;
    });
  };
  let planned = schedule(out);

  // Site work that is always added and waits for nothing (Site handover) comes after the site work that ends last.
  const wrapUp = ordered.filter(([, g]) => g.template.autoAdd && g.template.category === 'installation' && !g.lines.length && !g.template.dependsOnId).map(([k]) => k);
  if (wrapUp.length) {
    const endOf = (key: string) => planned.filter((p) => (p.key === key || p.parentKey === key) && p.endDate).reduce<string | null>((a, p) => (!a || p.endDate! > a ? p.endDate! : a), null);
    const site = ordered.filter(([k, g]) => g.template.category === 'installation' && !wrapUp.includes(k)).map(([k]) => ({ k, end: endOf(k) }));
    const last = site.filter((s) => s.end).sort((a, b) => b.end!.localeCompare(a.end!))[0];
    if (last) {
      planned = schedule(planned.map((p) => (wrapUp.includes(p.key) ? { ...p, dependsOnKey: last.k } : p)));
    }
  }
  return planned;
}
