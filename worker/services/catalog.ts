/**
 * The Task Lists (formerly "Catalogue"): common tasks and their standard sub-tasks, each with a duration rule, an
 * optional finish → start dependency (task → task, sub-task → sibling sub-task) and the BOQ words that match it.
 */
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Category } from '@shared/categories';
import { createCatalogItemSchema, FIXED_ONE_DAY, type CatalogItemDto, type CreateCatalogItemInput, type PatchCatalogItemInput } from '@shared/schemas/plan';
import { RULE_UNITS, type DurationRule, type RuleUnit } from '@shared/schedule/rules';
import { newId, nowIso, schema, type Db } from '../db/client';
import { HttpError } from './http-error';

type Row = typeof schema.catalogItems.$inferSelect;

function parseMatch(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toCatalogDto(r: Row): CatalogItemDto {
  const unit = (RULE_UNITS as readonly string[]).includes(r.rateUnit ?? '') ? (r.rateUnit as RuleUnit) : null;
  const rule: DurationRule =
    r.durationMode === 'per_qty' && r.perQty && unit
      ? { mode: 'per_qty', days: r.durationDays, perQty: r.perQty, unit, minDays: r.minDays }
      : { mode: 'fixed', days: r.durationDays, perQty: null, unit: null, minDays: 1 };
  return {
    id: r.id,
    category: r.category as Category,
    parentId: r.parentId,
    name: r.name,
    sortOrder: r.sortOrder,
    rule,
    dependsOnId: r.dependsOnId,
    boqMatch: parseMatch(r.boqMatch),
    autoAdd: r.autoAdd,
  };
}

function ruleColumns(rule: DurationRule) {
  return rule.mode === 'per_qty'
    ? { durationMode: 'per_qty', durationDays: rule.days, perQty: rule.perQty, rateUnit: rule.unit, minDays: rule.minDays }
    : { durationMode: 'fixed', durationDays: rule.days, perQty: null, rateUnit: null, minDays: 1 };
}

/** Trimmed, de-duplicated match words (case-insensitive). */
export function cleanMatch(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words.map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean)) {
    if (seen.has(w.toLowerCase())) continue;
    seen.add(w.toLowerCase());
    out.push(w);
  }
  return out;
}

export async function listCatalog(d: Db): Promise<CatalogItemDto[]> {
  const rows = await d.select().from(schema.catalogItems).orderBy(asc(schema.catalogItems.category), asc(schema.catalogItems.sortOrder), asc(schema.catalogItems.name));
  return rows.map(toCatalogDto);
}

async function getItem(d: Db, id: string): Promise<Row> {
  const [r] = await d.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id));
  if (!r) throw new HttpError(404, 'That Task List entry no longer exists');
  return r;
}

function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e)) || /UNIQUE constraint failed/i.test(String((e as { cause?: Error })?.cause?.message ?? ''));
}

/** Task → another task; sub-task → a sibling sub-task; never a loop. */
async function checkDependency(d: Db, item: { id: string | null; parentId: string | null }, depId: string | null | undefined): Promise<void> {
  if (!depId) return;
  if (depId === item.id) throw new HttpError(400, 'An entry cannot wait for itself');
  const all = await d.select({ id: schema.catalogItems.id, parentId: schema.catalogItems.parentId, dependsOnId: schema.catalogItems.dependsOnId }).from(schema.catalogItems);
  const dep = all.find((x) => x.id === depId);
  if (!dep) throw new HttpError(400, 'That Task List entry no longer exists');
  if ((dep.parentId ?? null) !== (item.parentId ?? null)) {
    throw new HttpError(400, item.parentId ? 'A sub-task can wait for another sub-task of the same task' : 'A task can wait for another task');
  }
  // Walk the chain from the new predecessor: reaching this entry again means a loop.
  const next = new Map(all.map((x) => [x.id, x.dependsOnId]));
  let cur: string | null | undefined = depId;
  for (let i = 0; cur && i <= all.length; i++) {
    if (cur === item.id) throw new HttpError(400, 'That would make a loop of entries waiting on each other');
    cur = next.get(cur);
  }
}

export async function createCatalogItem(d: Db, raw: CreateCatalogItemInput): Promise<CatalogItemDto> {
  const input = createCatalogItemSchema.parse(raw);
  let category = input.category;
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await getItem(d, parentId);
    if (parent.parentId) throw new HttpError(400, 'Sub-tasks go one level deep, under a task');
    category = parent.category as Category;
  }
  await checkDependency(d, { id: null, parentId }, input.dependsOnId);
  const where = and(eq(schema.catalogItems.category, category), parentId ? eq(schema.catalogItems.parentId, parentId) : isNull(schema.catalogItems.parentId));
  const [m] = await d.select({ max: sql<number>`coalesce(max(${schema.catalogItems.sortOrder}), 0)` }).from(schema.catalogItems).where(where);
  const id = newId();
  const now = nowIso();
  try {
    await d.insert(schema.catalogItems).values({
      id,
      category,
      parentId,
      name: input.name,
      sortOrder: Number(m?.max ?? 0) + 1,
      ...ruleColumns(input.rule ?? FIXED_ONE_DAY),
      dependsOnId: input.dependsOnId ?? null,
      boqMatch: JSON.stringify(cleanMatch(input.boqMatch ?? [])),
      autoAdd: !parentId && !!input.autoAdd,
      createdAt: now,
      updatedAt: now,
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, `"${input.name}" is already in this Task List`);
    throw e;
  }
  return toCatalogDto(await getItem(d, id));
}

export async function patchCatalogItem(d: Db, id: string, input: PatchCatalogItemInput): Promise<CatalogItemDto[]> {
  const item = await getItem(d, id);
  const now = nowIso();
  if (input.dependsOnId !== undefined) await checkDependency(d, { id, parentId: item.parentId }, input.dependsOnId);
  const set: Partial<typeof schema.catalogItems.$inferInsert> = { updatedAt: now };
  if (input.name) set.name = input.name;
  if (input.rule) Object.assign(set, ruleColumns(input.rule));
  if (input.dependsOnId !== undefined) set.dependsOnId = input.dependsOnId;
  if (input.boqMatch) set.boqMatch = JSON.stringify(cleanMatch(input.boqMatch));
  if (input.autoAdd !== undefined && !item.parentId) set.autoAdd = input.autoAdd;
  try {
    if (input.category && input.category !== item.category) {
      if (item.parentId) throw new HttpError(400, "Sub-tasks use their task's category");
      // A task moves with its sub-tasks; it can no longer wait for a task of its old place, so nothing changes there.
      await d.batch([
        d.update(schema.catalogItems).set({ ...set, category: input.category }).where(eq(schema.catalogItems.id, id)),
        d.update(schema.catalogItems).set({ category: input.category, updatedAt: now }).where(eq(schema.catalogItems.parentId, id)),
      ]);
    } else {
      await d.update(schema.catalogItems).set(set).where(eq(schema.catalogItems.id, id));
    }
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, `"${input.name ?? item.name}" is already in this Task List`);
    throw e;
  }
  return listCatalog(d);
}

/** Adds words to an entry's BOQ matches ("remember" in the quote import). */
export async function addMatchWords(d: Db, id: string, words: string[]): Promise<void> {
  const item = await getItem(d, id);
  const merged = cleanMatch([...parseMatch(item.boqMatch), ...words]);
  await d.update(schema.catalogItems).set({ boqMatch: JSON.stringify(merged), updatedAt: nowIso() }).where(eq(schema.catalogItems.id, id));
}

/** Deleting a task deletes its sub-tasks (cascade). Planner tasks keep their titles; their Task List link becomes null. */
export async function deleteCatalogItem(d: Db, id: string): Promise<void> {
  await getItem(d, id);
  await d.delete(schema.catalogItems).where(eq(schema.catalogItems.id, id));
}

export async function reorderCatalog(d: Db, ids: string[]): Promise<CatalogItemDto[]> {
  if (!ids.length) return listCatalog(d);
  const first = await getItem(d, ids[0]!);
  const siblings = await d
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.category, first.category), first.parentId ? eq(schema.catalogItems.parentId, first.parentId) : isNull(schema.catalogItems.parentId)));
  const have = new Set(siblings.map((s) => s.id));
  if (have.size !== ids.length || !ids.every((x) => have.has(x))) throw new HttpError(409, 'The Task List changed; reload and try again');
  const stmts = ids.map((cid, i) => d.update(schema.catalogItems).set({ sortOrder: i + 1 }).where(eq(schema.catalogItems.id, cid)));
  await d.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  return listCatalog(d);
}
