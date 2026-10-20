/**
 * Drafting a project's tasks from a BOQ quote (docs/PLAN.md "Import from a quote"). The browser sends the quote lines
 * it was shown (copied from BOQ Maker through /api/links) and the choices made in the review; this re-runs the same
 * shared/schedule/import.ts plan and writes it: tasks, sub-tasks, dependencies and a copy of the lines.
 *
 * Lines given a one-off task with "save to Task Lists" become new Task List tasks first (with the line's name as a
 * match word, so the next quote with that line finds it); "remember" adds a line's name to the tasks picked for it.
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { importQuoteSchema, type CatalogItemDto, type ImportQuoteInput } from '@shared/schemas/plan';
import { buildImportPlan, matchLine, type LineChoice } from '@shared/schedule/import';
import { newId, nowIso, schema, type Db } from '../db/client';
import type { SessionUser } from '../auth/session';
import { addMatchWords, createCatalogItem, listCatalog } from './catalog';
import { HttpError } from './http-error';

type Stmt = BatchItem<'sqlite'>;

async function findTemplate(d: Db, category: string, name: string): Promise<string | null> {
  const [r] = await d
    .select({ id: schema.catalogItems.id })
    .from(schema.catalogItems)
    .where(and(eq(schema.catalogItems.category, category), isNull(schema.catalogItems.parentId), sql`lower(${schema.catalogItems.name}) = ${name.toLowerCase()}`));
  return r?.id ?? null;
}

/** Saves one-off tasks marked "save to Task Lists" and remembered matches; returns the choices as the plan needs them. */
async function settleChoices(d: Db, input: ReturnType<typeof importQuoteSchema.parse>, catalog: CatalogItemDto[]): Promise<LineChoice[]> {
  const lines = new Map(input.lines.map((l) => [l.id, l]));
  const out: LineChoice[] = [];
  for (const c of input.choices) {
    const line = lines.get(c.lineId);
    if (!line) continue;
    const choice: LineChoice = { lineId: c.lineId, include: c.include, templateIds: [...c.templateIds], custom: null };
    if (c.include && c.custom) {
      if (c.custom.saveToList) {
        const existing = await findTemplate(d, c.custom.category, c.custom.name);
        const id = existing ?? (await createCatalogItem(d, { category: c.custom.category, name: c.custom.name, rule: c.custom.rule, boqMatch: [line.name] })).id;
        if (existing) await addMatchWords(d, existing, [line.name]);
        choice.templateIds.push(id);
      } else {
        choice.custom = { name: c.custom.name, category: c.custom.category, rule: c.custom.rule };
      }
    }
    if (c.include && c.remember) {
      for (const tid of c.templateIds) {
        const t = catalog.find((x) => x.id === tid);
        if (t && !matchLine(line, [t]).length) await addMatchWords(d, tid, [line.name]);
      }
    }
    out.push(choice);
  }
  return out;
}

/** The statements that add a quote's draft to `projectId` (appended after its existing tasks), and the new task ids. */
export async function importStatements(d: Db, user: SessionUser, projectId: string, raw: ImportQuoteInput): Promise<{ stmts: Stmt[]; ids: string[] }> {
  const input = importQuoteSchema.parse(raw);
  const choices = await settleChoices(d, input, await listCatalog(d));
  const items = await listCatalog(d);
  const plan = buildImportPlan({ lines: input.lines, choices, items, extraTemplateIds: input.extraTemplateIds, startDate: input.startDate, quoteLabel: input.quoteLabel || 'the quote' });
  if (!plan.length) throw new HttpError(400, 'Nothing to add: every line was skipped');

  const [m] = await d.select({ max: sql<number>`coalesce(max(${schema.tasks.sortOrder}), 0)` }).from(schema.tasks).where(and(eq(schema.tasks.projectId, projectId), isNull(schema.tasks.parentId)));
  let top = Number(m?.max ?? 0);
  const sub = new Map<string, number>();
  const idOf = new Map(plan.map((p) => [p.key, newId()]));
  const now = nowIso();
  const stmts: Stmt[] = [];

  for (const p of plan) {
    const sortOrder = p.parentKey ? (sub.set(p.parentKey, (sub.get(p.parentKey) ?? 0) + 1), sub.get(p.parentKey)!) : ++top;
    stmts.push(
      d.insert(schema.tasks).values({
        id: idOf.get(p.key)!,
        projectId,
        parentId: p.parentKey ? idOf.get(p.parentKey)! : null,
        title: p.title,
        category: p.category,
        catalogItemId: p.catalogItemId,
        startDate: p.startDate,
        endDate: p.endDate,
        plannedDays: p.plannedDays,
        quantities: JSON.stringify(p.quantities),
        notes: p.notes,
        sortOrder,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }
  // Dependencies once every row exists.
  for (const p of plan) {
    if (p.dependsOnKey) stmts.push(d.update(schema.tasks).set({ dependsOnId: idOf.get(p.dependsOnKey)! }).where(eq(schema.tasks.id, idOf.get(p.key)!)));
  }
  const fed = new Map(choices.map((c) => [c.lineId, c]));
  input.lines.forEach((l, i) => {
    const c = fed.get(l.id);
    stmts.push(
      d.insert(schema.projectQuoteLines).values({
        id: newId(),
        projectId,
        boqQuoteId: input.quoteId,
        boqLineId: l.id,
        area: l.area,
        code: l.code,
        name: l.name,
        unit: l.unit,
        qty: l.qty,
        optional: l.optional,
        boqCategory: l.category,
        included: !!c?.include,
        catalogItemIds: JSON.stringify(c?.include ? c.templateIds : []),
        sortOrder: i + 1,
        createdAt: now,
      }),
    );
  });
  return { stmts, ids: [...idOf.values()] };
}
