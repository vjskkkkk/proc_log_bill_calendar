import { Hono } from 'hono';
import { canEdit, requireAuth, type AppEnv } from '../auth/middleware';
import { db } from '../db/client';
import { errorResponse } from '../services/http-error';
import { boqQuoteLines, boqQuotes, crmLeads } from '../services/links';

/** Sources for the New project dialog. Always 200: `{ items, unavailable? }` (worker/services/links.ts). */
export const linkRoutes = new Hono<AppEnv>();
linkRoutes.use('*', requireAuth(), canEdit);
linkRoutes.onError(errorResponse);

linkRoutes.get('/boq-quotes', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await boqQuotes(c.env, db(c.env.DB), (c.req.query('q') ?? '').slice(0, 100)));
});

linkRoutes.get('/boq-quotes/:id/lines', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await boqQuoteLines(c.env, c.req.param('id').slice(0, 100)));
});

linkRoutes.get('/crm-leads', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await crmLeads(c.env, db(c.env.DB), c.req.query('lost') === '1'));
});
