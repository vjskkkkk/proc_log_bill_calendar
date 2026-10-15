import { Hono } from 'hono';
import { createTaskSchema, patchTaskSchema, reorderTasksSchema, shiftTaskSchema } from '@shared/schemas/plan';
import { canEdit, requireAuth, type AppEnv } from '../auth/middleware';
import { db } from '../db/client';
import { errorResponse } from '../services/http-error';
import { createTask, deleteTask, patchTask, reorderTasks, shiftTask } from '../services/tasks';
import { parseBody } from './util';

export const taskRoutes = new Hono<AppEnv>();
taskRoutes.use('*', requireAuth(), canEdit);
taskRoutes.onError(errorResponse);

taskRoutes.post('/', async (c) => {
  const body = await parseBody(c, createTaskSchema);
  if (!body.ok) return body.response;
  return c.json(await createTask(db(c.env.DB), c.get('user'), body.data), 201);
});

taskRoutes.post('/reorder', async (c) => {
  const body = await parseBody(c, reorderTasksSchema);
  if (!body.ok) return body.response;
  return c.json(await reorderTasks(db(c.env.DB), body.data.projectId, body.data.parentId, body.data.ids));
});

taskRoutes.patch('/:id', async (c) => {
  const body = await parseBody(c, patchTaskSchema);
  if (!body.ok) return body.response;
  return c.json(await patchTask(db(c.env.DB), c.get('user'), c.req.param('id'), body.data));
});

taskRoutes.post('/:id/shift', async (c) => {
  const body = await parseBody(c, shiftTaskSchema);
  if (!body.ok) return body.response;
  return c.json(await shiftTask(db(c.env.DB), c.get('user'), c.req.param('id'), body.data.days));
});

taskRoutes.delete('/:id', async (c) => c.json(await deleteTask(db(c.env.DB), c.get('user'), c.req.param('id'))));
