import { Hono } from 'hono';
import { PROJECT_STATUSES, type ProjectStatus } from '@shared/schemas/plan';
import { isIsoDate, todayIST } from '@shared/schedule/dates';
import { selectToday } from '@shared/schedule/today';
import { requireAuth, type AppEnv } from '../auth/middleware';
import { db } from '../db/client';
import { readVersion } from '../services/batch';
import { errorResponse } from '../services/http-error';
import { loadPlan } from '../services/plan';

export const planRoutes = new Hono<AppEnv>();
planRoutes.use('*', requireAuth());
planRoutes.onError(errorResponse);

function statusesParam(raw: string | undefined): ProjectStatus[] {
  const list = (raw ?? 'active,on_hold').split(',').filter((s): s is ProjectStatus => (PROJECT_STATUSES as readonly string[]).includes(s));
  return list.length ? list : ['active'];
}

/** Projects, tasks and people for the Planner/Today (default: active and on-hold projects). */
planRoutes.get('/', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await loadPlan(db(c.env.DB), statusesParam(c.req.query('statuses'))));
});

/** Cheap poll: open tabs refetch the plan only when this changes. */
planRoutes.get('/version', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ version: await readVersion(db(c.env.DB)) });
});

export const todayRoutes = new Hono<AppEnv>();
todayRoutes.use('*', requireAuth());
todayRoutes.onError(errorResponse);

/** The same list the Today page computes in the browser (shared/schedule/today.ts). */
todayRoutes.get('/', async (c) => {
  const today = todayIST();
  const date = c.req.query('date') ?? today;
  if (!isIsoDate(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  const scope = c.req.query('scope') === 'mine' ? 'mine' : 'all';
  const plan = await loadPlan(db(c.env.DB), ['active']);
  c.header('Cache-Control', 'no-store');
  return c.json(selectToday(plan.projects, plan.tasks, { date, today, userId: c.get('user').id, scope }));
});
