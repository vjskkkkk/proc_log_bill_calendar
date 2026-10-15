// Drizzle mirror of migrations/*.sql (kept in step by hand; the SQL files are the source of truth).
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: text('role', { enum: ['admin', 'editor', 'viewer'] }).notNull(),
  passwordHash: text('password_hash').notNull(),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(true),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  lastLoginAt: text('last_login_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: text('expires_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('sessions_user_id').on(t.userId), index('sessions_expires_at').on(t.expiresAt)],
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const catalogItems = sqliteTable('catalog_items', {
  id: text('id').primaryKey(),
  category: text('category').notNull(),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  client: text('client').notNull().default(''),
  location: text('location').notNull().default(''),
  status: text('status').notNull().default('active'),
  boqQuoteId: text('boq_quote_id'),
  boqRootQuoteId: text('boq_root_quote_id'),
  boqQuoteNo: text('boq_quote_no').notNull().default(''),
  crmLeadId: text('crm_lead_id'),
  notes: text('notes').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  category: text('category').notNull(),
  catalogItemId: text('catalog_item_id'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  assigneeId: text('assignee_id'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  doneAt: text('done_at'),
  doneBy: text('done_by'),
  notes: text('notes').notNull().default(''),
  sortOrder: integer('sort_order').notNull().default(0),
  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
