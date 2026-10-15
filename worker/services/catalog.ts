import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Category } from '@shared/categories';
import type { CatalogItemDto, CreateCatalogItemInput } from '@shared/schemas/plan';
import { newId, nowIso, schema, type Db } from '../db/client';
import { HttpError } from './http-error';

type Row = typeof schema.catalogItems.$inferSelect;

function toDto(r: Row): CatalogItemDto {
  return { id: r.id, category: r.category as Category, parentId: r.parentId, name: r.name, sortOrder: r.sortOrder };
}

export async function listCatalog(d: Db): Promise<CatalogItemDto[]> {
  const rows = await d.select().from(schema.catalogItems).orderBy(asc(schema.catalogItems.category), asc(schema.catalogItems.sortOrder), asc(schema.catalogItems.name));
  return rows.map(toDto);
}

async function getItem(d: Db, id: string): Promise<Row> {
  const [r] = await d.select().from(schema.catalogItems).where(eq(schema.catalogItems.id, id));
  if (!r) throw new HttpError(404, 'That catalogue item no longer exists');
  return r;
}

function isUniqueViolation(e: unknown): boolean {
  return /UNIQUE constraint failed/i.test(String((e as Error)?.message ?? e)) || /UNIQUE constraint failed/i.test(String((e as { cause?: Error })?.cause?.message ?? ''));
}

export async function createCatalogItem(d: Db, input: CreateCatalogItemInput): Promise<CatalogItemDto> {
  let category = input.category;
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await getItem(d, parentId);
    if (parent.parentId) throw new HttpError(400, 'Standard steps go one level deep, under a task template');
    category = parent.category as Category;
  }
  const where = and(eq(schema.catalogItems.category, category), parentId ? eq(schema.catalogItems.parentId, parentId) : isNull(schema.catalogItems.parentId));
  const [m] = await d.select({ max: sql<number>`coalesce(max(${schema.catalogItems.sortOrder}), 0)` }).from(schema.catalogItems).where(where);
  const id = newId();
  const now = nowIso();
  try {
    await d.insert(schema.catalogItems).values({ id, category, parentId, name: input.name, sortOrder: Number(m?.max ?? 0) + 1, createdAt: now, updatedAt: now });
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, `"${input.name}" is already in the catalogue here`);
    throw e;
  }
  return toDto(await getItem(d, id));
}

export async function patchCatalogItem(d: Db, id: string, input: { name?: string | undefined; category?: Category | undefined }): Promise<CatalogItemDto[]> {
  const item = await getItem(d, id);
  const now = nowIso();
  try {
    if (input.category && input.category !== item.category) {
      if (item.parentId) throw new HttpError(400, "Standard steps use their template's category");
      // A template moves with its steps.
      await d.batch([
        d.update(schema.catalogItems).set({ category: input.category, ...(input.name ? { name: input.name } : {}), updatedAt: now }).where(eq(schema.catalogItems.id, id)),
        d.update(schema.catalogItems).set({ category: input.category, updatedAt: now }).where(eq(schema.catalogItems.parentId, id)),
      ]);
    } else if (input.name) {
      await d.update(schema.catalogItems).set({ name: input.name, updatedAt: now }).where(eq(schema.catalogItems.id, id));
    }
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, `"${input.name ?? item.name}" is already in the catalogue here`);
    throw e;
  }
  return listCatalog(d);
}

/** Deleting a template deletes its steps (cascade). Tasks keep their titles; their catalogue link becomes null. */
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
  if (have.size !== ids.length || !ids.every((x) => have.has(x))) throw new HttpError(409, 'The catalogue changed; reload and try again');
  const stmts = ids.map((cid, i) => d.update(schema.catalogItems).set({ sortOrder: i + 1 }).where(eq(schema.catalogItems.id, cid)));
  await d.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  return listCatalog(d);
}
