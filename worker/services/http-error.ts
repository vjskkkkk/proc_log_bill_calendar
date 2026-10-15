import type { Context } from 'hono';

/** Thrown by services; app.onError turns it into `{ error, ...extra }` with this status. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function errorResponse(err: Error, c: Context<any>): Response {
  if (err instanceof HttpError) return c.json({ error: err.message, ...err.extra }, err.status as 400);
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
}
