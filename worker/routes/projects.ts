import { Hono } from 'hono';
import { createProjectSchema, patchProjectSchema, reorderSchema } from '@shared/schemas/plan';
import { canEdit, requireAuth, requireRole, type AppEnv } from '../auth/middleware';
import { db } from '../db/client';
import { errorResponse } from '../services/http-error';
import { createProject, deleteProject, patchProject, reorderProjects } from '../services/projects';
import { parseBody } from './util';

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use('*', requireAuth());
projectRoutes.onError(errorResponse);

projectRoutes.post('/', canEdit, async (c) => {
  const body = await parseBody(c, createProjectSchema);
  if (!body.ok) return body.response;
  return c.json(await createProject(db(c.env.DB), c.get('user'), body.data), 201);
});

projectRoutes.post('/reorder', canEdit, async (c) => {
  const body = await parseBody(c, reorderSchema);
  if (!body.ok) return body.response;
  return c.json(await reorderProjects(db(c.env.DB), body.data.ids));
});

projectRoutes.patch('/:id', canEdit, async (c) => {
  const body = await parseBody(c, patchProjectSchema);
  if (!body.ok) return body.response;
  return c.json(await patchProject(db(c.env.DB), c.req.param('id'), body.data));
});

projectRoutes.delete('/:id', requireRole('admin'), async (c) => c.json(await deleteProject(db(c.env.DB), c.req.param('id'))));
