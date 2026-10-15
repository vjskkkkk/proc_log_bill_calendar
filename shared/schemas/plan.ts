import { z } from 'zod';
import { CATEGORIES, type Category } from '../categories';
import { isIsoDate, type IsoDate } from '../schedule/dates';
import type { Role } from '../types';

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  archived: 'Archived',
};

// ---- DTOs (what the API returns) ----

export interface ProjectDto {
  id: string;
  name: string;
  client: string;
  location: string;
  status: ProjectStatus;
  boqQuoteId: string | null;
  boqRootQuoteId: string | null;
  boqQuoteNo: string;
  crmLeadId: string | null;
  notes: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDto {
  id: string;
  projectId: string;
  parentId: string | null;
  title: string;
  category: Category;
  catalogItemId: string | null;
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  assigneeId: string | null;
  done: boolean;
  doneAt: string | null;
  doneById: string | null;
  notes: string;
  sortOrder: number;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Team members as the planner sees them (no email, no hash). */
export interface PersonDto {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

export interface PlanDto {
  /** IST today on the server. */
  today: IsoDate;
  version: string;
  projects: ProjectDto[];
  tasks: TaskDto[];
  people: PersonDto[];
}

/** Every task write answers with the rows it changed, so the client patches its cache without a refetch. */
export interface TaskChanges {
  tasks: TaskDto[];
  deletedIds: string[];
  version: string;
}

export interface CatalogItemDto {
  id: string;
  category: Category;
  parentId: string | null;
  name: string;
  sortOrder: number;
}

// ---- Link sources (New project dialog) ----

export interface BoqQuoteSummary {
  id: string;
  rootQuoteId: string;
  quoteNo: string;
  displayNo: string;
  revision: number;
  status: string;
  quoteType: string;
  clientCompany: string;
  clientName: string;
  projectName: string;
  location: string;
  crmLeadId: string | null;
  pdfIssuedAt: string | null;
  linkedProjectId: string | null;
}

export interface CrmLeadSummary {
  id: string;
  company: string;
  contact: string;
  product: string;
  stage: number;
  outcome: string;
  linkedProjectId: string | null;
}

export interface LinkList<T> {
  items: T[];
  /** Set when the other app could not be asked; the dialog shows it and the other tabs keep working. */
  unavailable?: string;
}

// ---- Inputs (zod) ----

export const isoDateSchema = z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD');
const id = z.string().trim().min(1).max(100);
const nullableId = id.nullable();
const categorySchema = z.enum(CATEGORIES);
const title = z.string().trim().min(1, 'Required').max(300);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  client: z.string().trim().max(200).default(''),
  location: z.string().trim().max(200).default(''),
  status: z.enum(PROJECT_STATUSES).default('active'),
  boqQuoteId: nullableId.optional(),
  boqRootQuoteId: nullableId.optional(),
  boqQuoteNo: z.string().trim().max(100).default(''),
  crmLeadId: nullableId.optional(),
  notes: z.string().max(5000).default(''),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

export const patchProjectSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(200).optional(),
  client: z.string().trim().max(200).optional(),
  location: z.string().trim().max(200).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  notes: z.string().max(5000).optional(),
});
export type PatchProjectInput = z.infer<typeof patchProjectSchema>;

export const reorderSchema = z.object({ ids: z.array(id).min(1).max(2000) });

export const createTaskSchema = z.object({
  /** Made by the browser (crypto.randomUUID) so optimistic rows never swap ids. */
  id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/, 'Invalid id'),
  projectId: id,
  parentId: nullableId.optional(),
  /** Insert after this sibling (null/absent = at the end). */
  afterId: nullableId.optional(),
  title,
  category: categorySchema.optional(),
  catalogItemId: nullableId.optional(),
  startDate: isoDateSchema.nullable().optional(),
  endDate: isoDateSchema.nullable().optional(),
  assigneeId: nullableId.optional(),
  notes: z.string().max(5000).optional(),
  /** When a catalogue task template is picked for a task, also add its standard steps (default true). */
  addCatalogSteps: z.boolean().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const patchTaskSchema = z.object({
  title: title.optional(),
  category: categorySchema.optional(),
  catalogItemId: nullableId.optional(),
  startDate: isoDateSchema.nullable().optional(),
  endDate: isoDateSchema.nullable().optional(),
  assigneeId: nullableId.optional(),
  done: z.boolean().optional(),
  notes: z.string().max(5000).optional(),
  addCatalogSteps: z.boolean().optional(),
});
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

export const shiftTaskSchema = z.object({ days: z.number().int().min(-3650).max(3650) });

export const reorderTasksSchema = z.object({
  projectId: id,
  parentId: nullableId,
  ids: z.array(id).min(1).max(2000),
});

export const createCatalogItemSchema = z.object({
  category: categorySchema,
  parentId: nullableId.optional(),
  name: z.string().trim().min(1, 'Required').max(300),
});
export type CreateCatalogItemInput = z.infer<typeof createCatalogItemSchema>;

export const patchCatalogItemSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(300).optional(),
  category: categorySchema.optional(),
});
