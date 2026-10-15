import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

export function db(d1: D1Database) {
  return drizzle(d1, { schema });
}
export type Db = ReturnType<typeof db>;
export { schema };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Splits a list for `IN (…)` queries: D1 allows at most 100 bound parameters per statement. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
