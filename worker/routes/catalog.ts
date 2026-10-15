import { Hono } from 'hono';
import { createCatalogItemSchema, patchCatalogItemSchema, reorderSchema } from '@shared/schemas/plan';
import { canEdit, requireAuth, type AppEnv } from '../auth/middleware';
import { db } from '../db/client';
import { createCatalogItem, deleteCatalogItem, listCatalog, patchCatalogItem, reorderCatalog } from '../services/catalog';
import { errorResponse } from '../services/http-error';
import { parseBody } from './util';

export const catalogRoutes = new Hono<AppEnv>();
catalogRoutes.use('*', requireAuth());
catalogRoutes.onError(errorResponse);

catalogRoutes.get('/', async (c) => c.json({ items: await listCatalog(db(c.env.DB)) }));

catalogRoutes.post('/', canEdit, async (c) => {
  const body = await parseBody(c, createCatalogItemSchema);
  if (!body.ok) return body.response;
  const item = await createCatalogItem(db(c.env.DB), body.data);
  return c.json({ item, items: await listCatalog(db(c.env.DB)) }, 201);
});

catalogRoutes.post('/reorder', canEdit, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.response;
  return c.json({ items: await reorderCatalog(db(c.env.DB), body.data.ids) });
});

catalogRoutes.patch('/:id', canEdit, async (c) => {
  const body = await parseBody(c, patchCatalogItemSchema);
  if (!body.ok) return body.response;
  return c.json({ items: await patchCatalogItem(db(c.env.DB), c.req.param('id'), body.data) });
});

catalogRoutes.delete('/:id', canEdit, async (c) => {
  await deleteCatalogItem(db(c.env.DB), c.req.param('id'));
  return c.json({ items: await listCatalog(db(c.env.DB)) });
});
