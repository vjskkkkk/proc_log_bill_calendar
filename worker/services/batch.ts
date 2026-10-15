import { eq, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { nowIso, schema, type Db } from '../db/client';

export const PLAN_VERSION_KEY = 'plan_version';

/** The statement every planner write adds to its batch (CLAUDE.md rule 6). */
export function bumpVersion(d: Db): BatchItem<'sqlite'> {
  return d
    .update(schema.settings)
    .set({ value: sql`CAST(${schema.settings.value} AS INTEGER) + 1`, updatedAt: nowIso() })
    .where(eq(schema.settings.key, PLAN_VERSION_KEY));
}

export async function readVersion(d: Db): Promise<string> {
  const [row] = await d.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, PLAN_VERSION_KEY));
  return row?.value ?? '0';
}

/** Runs the statements plus a version bump atomically (one D1 batch = one transaction); returns the new version. */
export async function writeBatch(d: Db, stmts: BatchItem<'sqlite'>[]): Promise<string> {
  const read = d.select({ value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.key, PLAN_VERSION_KEY));
  const all = [...stmts, bumpVersion(d), read] as unknown as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]];
  const results = (await d.batch(all)) as unknown[];
  const last = results[results.length - 1] as { value: string }[];
  return last[0]?.value ?? '0';
}
