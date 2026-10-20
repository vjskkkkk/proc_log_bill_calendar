import { z } from 'zod';
import { CATEGORIES, type Category } from '../categories';
import { isIsoDate, type IsoDate } from '../schedule/dates';
import type { QuoteLine } from '../schedule/import';
import { DURATION_MODES, RULE_UNITS, type DurationRule, type Quantities } from '../schedule/rules';
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
  /** Finish → start: this row starts the working day after that task/sub-task ends. */
  dependsOnId: string | null;
  /** Working days it should take (from its Task List rule); used while the row has no dates. */
  plannedDays: number | null;
  /** What the quote asked for, by unit ({ sqft: 8000 }); {} when typed by hand. */
  quantities: Quantities;
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

/** A Task List entry: a task (parentId null) or one of its standard sub-tasks. */
export interface CatalogItemDto {
  id: string;
  category: Category;
  parentId: string | null;
  name: string;
  sortOrder: number;
  rule: DurationRule;
  /** A task waits for another Task List task; a sub-task for a sibling sub-task. */
  dependsOnId: string | null;
  /** Words (or BOQ codes) that send a quote line to this task. */
  boqMatch: string[];
  /** Added to every project drafted from a quote, line or no line (invoices, team travel …). */
  autoAdd: boolean;
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

/** A quote's line items as BOQ Maker shares them: names, units and quantities, never prices. */
export interface BoqQuoteLines {
  quote: { id: string; rootQuoteId: string; displayNo: string; projectName: string; clientCompany: string } | null;
  lines: QuoteLine[];
  unavailable?: string;
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

export const durationRuleSchema = z
  .object({
    mode: z.enum(DURATION_MODES),
    days: z.number().positive('Days must be more than 0').max(3650),
    perQty: z.number().positive().max(1e9).nullable(),
    unit: z.enum(RULE_UNITS).nullable(),
    minDays: z.number().int().min(1).max(3650),
  })
  .refine((r) => r.mode === 'fixed' || (r.perQty !== null && r.unit !== null), 'A per-quantity rule needs a quantity and a unit');
export const FIXED_ONE_DAY: DurationRule = { mode: 'fixed', days: 1, perQty: null, unit: null, minDays: 1 };

const plannedDays = z.number().int().min(1).max(3650);
const quantitiesSchema = z.partialRecord(z.enum(RULE_UNITS), z.number().nonnegative().max(1e12));

// ---- Drafting tasks from a BOQ quote ----

export const quoteLineSchema = z.object({
  id: id,
  area: z.string().max(300).default(''),
  sport: z.string().max(300).default(''),
  code: z.string().max(300).default(''),
  name: z.string().trim().min(1).max(500),
  unit: z.string().max(50).default(''),
  qty: z.number().min(0).max(1e12),
  optional: z.boolean().default(false),
  category: z.string().max(200).default(''),
  subCategory: z.string().max(200).default(''),
});

export const lineChoiceSchema = z.object({
  lineId: id,
  include: z.boolean(),
  templateIds: z.array(id).max(20),
  /** A task for this line that is not in the Task Lists; `saveToList` also adds it there (with the line as a match). */
  custom: z.object({ name: title, category: categorySchema, rule: durationRuleSchema, saveToList: z.boolean().default(true) }).nullable().optional(),
  /** Remember: add this line's name to the BOQ-match words of the Task List tasks picked for it by hand. */
  remember: z.boolean().optional(),
});
export type LineChoiceInput = z.input<typeof lineChoiceSchema>;

export const importQuoteSchema = z.object({
  quoteId: id,
  /** The quote's revision family (links a project that has no quote yet). */
  rootQuoteId: nullableId.optional(),
  quoteLabel: z.string().trim().max(100).default(''),
  startDate: isoDateSchema,
  lines: z.array(quoteLineSchema).max(1000),
  choices: z.array(lineChoiceSchema).max(1000),
  extraTemplateIds: z.array(id).max(200).default([]),
});
export type ImportQuoteInput = z.input<typeof importQuoteSchema>;

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
  /** Draft the project's tasks from its quote in the same write. */
  import: importQuoteSchema.optional(),
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
  dependsOnId: nullableId.optional(),
  plannedDays: plannedDays.nullable().optional(),
  quantities: quantitiesSchema.optional(),
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
  dependsOnId: nullableId.optional(),
  plannedDays: plannedDays.nullable().optional(),
  addCatalogSteps: z.boolean().optional(),
});
export type PatchTaskInput = z.infer<typeof patchTaskSchema>;

export const shiftTaskSchema = z.object({ days: z.number().int().min(-3650).max(3650) });

export const reorderTasksSchema = z.object({
  projectId: id,
  parentId: nullableId,
  ids: z.array(id).min(1).max(2000),
});

const boqMatchSchema = z.array(z.string().trim().min(1).max(200)).max(100);

export const createCatalogItemSchema = z.object({
  category: categorySchema,
  parentId: nullableId.optional(),
  name: z.string().trim().min(1, 'Required').max(300),
  rule: durationRuleSchema.optional(),
  dependsOnId: nullableId.optional(),
  boqMatch: boqMatchSchema.optional(),
  autoAdd: z.boolean().optional(),
});
export type CreateCatalogItemInput = z.input<typeof createCatalogItemSchema>;

export const patchCatalogItemSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(300).optional(),
  category: categorySchema.optional(),
  rule: durationRuleSchema.optional(),
  dependsOnId: nullableId.optional(),
  boqMatch: boqMatchSchema.optional(),
  autoAdd: z.boolean().optional(),
});
export type PatchCatalogItemInput = z.infer<typeof patchCatalogItemSchema>;

