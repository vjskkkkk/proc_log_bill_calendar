import { Hono } from 'hono';
import type { AppEnv } from '../auth/middleware';

export const healthRoutes = new Hono<AppEnv>();
healthRoutes.get('/', async (c) => {
  let db: 'ok' | 'error' = 'ok';
  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch {
    db = 'error';
  }
  return c.json({ ok: db === 'ok', db, app: c.env.APP_NAME, time: new Date().toISOString() });
});
