import type { Context } from 'hono';
import type { z } from 'zod';

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Validates a JSON body with a zod schema; returns a 400 response with field errors on failure. */
export async function parseBody<S extends z.ZodTypeAny>(c: Context<any>, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'Invalid JSON body' }, 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    return { ok: false, response: c.json({ error: 'Validation failed', details: result.error.flatten() }, 400) };
  }
  return { ok: true, data: result.data };
}
