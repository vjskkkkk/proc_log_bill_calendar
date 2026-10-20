import { eq, sql } from 'drizzle-orm';
import type { CreateProjectInput, ImportQuoteInput, PatchProjectInput, ProjectDto } from '@shared/schemas/plan';
import { createProjectSchema, importQuoteSchema } from '@shared/schemas/plan';
import { newId, nowIso, schema, type Db } from '../db/client';
import type { SessionUser } from '../auth/session';
import { writeBatch } from './batch';
import { HttpError } from './http-error';
import { importStatements } from './import';
import { toProjectDto } from './plan';

async function getProject(d: Db, id: string) {
  const [p] = await d.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!p) throw new HttpError(404, 'That project no longer exists');
  return p;
}

/** One project per BOQ quote family and per CRM lead: a second pick answers 409 with the existing project's id. */
async function assertNotLinked(d: Db, field: 'boqRootQuoteId' | 'crmLeadId', value: string | null | undefined) {
  if (!value) return;
  const [p] = await d.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(eq(schema.projects[field], value));
  if (p) {
    const what = field === 'crmLeadId' ? 'CRM lead' : 'BOQ quote';
    throw new HttpError(409, `This ${what} already has a project: ${p.name}`, { projectId: p.id });
  }
}

export async function createProject(d: Db, user: SessionUser, raw: CreateProjectInput): Promise<{ project: ProjectDto; version: string }> {
  const input = createProjectSchema.parse(raw);
  await assertNotLinked(d, 'boqRootQuoteId', input.boqRootQuoteId);
  await assertNotLinked(d, 'crmLeadId', input.crmLeadId);
  const [m] = await d.select({ max: sql<number>`coalesce(max(${schema.projects.sortOrder}), 0)` }).from(schema.projects);
  const id = newId();
  const now = nowIso();
  const drafted = input.import ? await importStatements(d, user, id, input.import) : null;
  const version = await writeBatch(d, [
    d.insert(schema.projects).values({
      id,
      name: input.name,
      client: input.client,
      location: input.location,
      status: input.status,
      boqQuoteId: input.boqQuoteId ?? null,
      boqRootQuoteId: input.boqRootQuoteId ?? (input.boqQuoteId ? input.boqQuoteId : null),
      boqQuoteNo: input.boqQuoteNo,
      crmLeadId: input.crmLeadId ?? null,
      notes: input.notes,
      sortOrder: Number(m?.max ?? 0) + 1,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    }),
    ...(drafted?.stmts ?? []),
  ]);
  return { project: toProjectDto(await getProject(d, id)), version };
}

/**
 * Adds a quote's draft to an existing project (after its current tasks). A project without a quote is linked to
 * this one; a project linked to another quote family is refused.
 */
export async function importIntoProject(d: Db, user: SessionUser, id: string, raw: ImportQuoteInput): Promise<{ project: ProjectDto; version: string; taskIds: string[] }> {
  const input = importQuoteSchema.parse(raw);
  const project = await getProject(d, id);
  const root = input.rootQuoteId ?? input.quoteId;
  const link: Partial<typeof schema.projects.$inferInsert> = {};
  if (!project.boqRootQuoteId) {
    await assertNotLinked(d, 'boqRootQuoteId', root);
    Object.assign(link, { boqQuoteId: input.quoteId, boqRootQuoteId: root, boqQuoteNo: input.quoteLabel });
  } else if (project.boqRootQuoteId !== root) {
    throw new HttpError(400, `This project is linked to quote ${project.boqQuoteNo || 'another quote'}`);
  }
  const drafted = await importStatements(d, user, id, input);
  const version = await writeBatch(d, [...drafted.stmts, d.update(schema.projects).set({ ...link, updatedAt: nowIso() }).where(eq(schema.projects.id, id))]);
  return { project: toProjectDto(await getProject(d, id)), version, taskIds: drafted.ids };
}

export async function patchProject(d: Db, id: string, input: PatchProjectInput): Promise<{ project: ProjectDto; version: string }> {
  await getProject(d, id);
  const version = await writeBatch(d, [d.update(schema.projects).set({ ...input, updatedAt: nowIso() }).where(eq(schema.projects.id, id))]);
  return { project: toProjectDto(await getProject(d, id)), version };
}

/** Admin only (route). Its tasks go with it (ON DELETE CASCADE). */
export async function deleteProject(d: Db, id: string): Promise<{ version: string }> {
  await getProject(d, id);
  return { version: await writeBatch(d, [d.delete(schema.projects).where(eq(schema.projects.id, id))]) };
}

export async function reorderProjects(d: Db, ids: string[]): Promise<{ version: string }> {
  const all = await d.select({ id: schema.projects.id }).from(schema.projects);
  const known = new Set(all.map((p) => p.id));
  if (!ids.every((x) => known.has(x)) || new Set(ids).size !== ids.length) throw new HttpError(409, 'The project list changed; reload and try again');
  const stmts = ids.map((pid, i) => d.update(schema.projects).set({ sortOrder: i + 1 }).where(eq(schema.projects.id, pid)));
  return { version: await writeBatch(d, stmts) };
}
