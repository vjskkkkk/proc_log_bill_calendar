import { asc, inArray } from 'drizzle-orm';
import type { Category } from '@shared/categories';
import type { PersonDto, PlanDto, ProjectDto, ProjectStatus, TaskDto } from '@shared/schemas/plan';
import { todayIST } from '@shared/schedule/dates';
import type { Role } from '@shared/types';
import { chunk, schema, type Db } from '../db/client';
import { PLAN_VERSION_KEY } from './batch';
import { eq } from 'drizzle-orm';

type ProjectRow = typeof schema.projects.$inferSelect;
type TaskRow = typeof schema.tasks.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

export function toProjectDto(p: ProjectRow): ProjectDto {
  return {
    id: p.id,
    name: p.name,
    client: p.client,
    location: p.location,
    status: p.status as ProjectStatus,
    boqQuoteId: p.boqQuoteId,
    boqRootQuoteId: p.boqRootQuoteId,
    boqQuoteNo: p.boqQuoteNo,
    crmLeadId: p.crmLeadId,
    notes: p.notes,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toTaskDto(t: TaskRow): TaskDto {
  return {
    id: t.id,
    projectId: t.projectId,
    parentId: t.parentId,
    title: t.title,
    category: t.category as Category,
    catalogItemId: t.catalogItemId,
    startDate: t.startDate,
    endDate: t.endDate,
    assigneeId: t.assigneeId,
    done: t.done,
    doneAt: t.doneAt,
    doneById: t.doneBy,
    notes: t.notes,
    sortOrder: t.sortOrder,
    createdById: t.createdBy,
    updatedById: t.updatedBy,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function toPersonDto(u: Pick<UserRow, 'id' | 'name' | 'role' | 'active'>): PersonDto {
  return { id: u.id, name: u.name, role: u.role as Role, active: u.active };
}

/** Everything the Planner and Today need, in one D1 batch. */
export async function loadPlan(d: Db, statuses: ProjectStatus[]): Promise<PlanDto> {
  const projectIds = d.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.status, statuses));
  const [projects, tasks, people, version] = await d.batch([
    d.select().from(schema.projects).where(inArray(schema.projects.status, statuses)).orderBy(asc(schema.projects.sortOrder), asc(schema.projects.name)),
    d.select().from(schema.tasks).where(inArray(schema.tasks.projectId, projectIds)).orderBy(asc(schema.tasks.sortOrder)),
    d.select({ id: schema.users.id, name: schema.users.name, role: schema.users.role, active: schema.users.active }).from(schema.users).orderBy(asc(schema.users.name)),
    d.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, PLAN_VERSION_KEY)),
  ]);
  return {
    today: todayIST(),
    version: version[0]?.value ?? '0',
    projects: projects.map(toProjectDto),
    tasks: tasks.map(toTaskDto),
    people: people.map(toPersonDto),
  };
}

/** Re-reads task rows by id (chunked under D1's 100-parameter limit). */
export async function tasksByIds(d: Db, ids: string[]): Promise<TaskDto[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const parts = chunk(unique, 90).map((c) => d.select().from(schema.tasks).where(inArray(schema.tasks.id, c)));
  const results = (await d.batch(parts as [(typeof parts)[number], ...(typeof parts)[number][]])) as TaskRow[][];
  // Stable order for callers: tasks before sub-tasks, then planner order.
  return results
    .flat()
    .map(toTaskDto)
    .sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null) || a.sortOrder - b.sortOrder);
}
