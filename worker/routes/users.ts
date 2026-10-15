import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db, newId, nowIso, schema } from '../db/client';
import { hashPassword } from '../auth/password';
import { destroyAllSessions, toPublic } from '../auth/session';
import { requireAuth, requireRole, type AppEnv } from '../auth/middleware';
import { createUserSchema, resetPasswordSchema, updateUserSchema } from '@shared/schemas/auth';
import { parseBody } from './util';

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth(), requireRole('admin'));

userRoutes.get('/', async (c) => {
  const rows = await db(c.env.DB).select().from(schema.users).orderBy(schema.users.name);
  return c.json({ users: rows.map(toPublic) });
});

userRoutes.post('/', async (c) => {
  const body = await parseBody(c, createUserSchema);
  if (!body.ok) return body.response;
  const existing = await db(c.env.DB).select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, body.data.email));
  if (existing.length) return c.json({ error: 'A user with this email already exists' }, 409);
  const id = newId();
  await db(c.env.DB).insert(schema.users).values({
    id,
    email: body.data.email,
    name: body.data.name,
    role: body.data.role,
    passwordHash: await hashPassword(body.data.temporaryPassword),
    mustChangePassword: true,
    active: true,
    createdAt: nowIso(),
  });
  const [u] = await db(c.env.DB).select().from(schema.users).where(eq(schema.users.id, id));
  return c.json({ user: u && toPublic(u) }, 201);
});

userRoutes.patch('/:id', async (c) => {
  const body = await parseBody(c, updateUserSchema);
  if (!body.ok) return body.response;
  const id = c.req.param('id');
  const me = c.get('user');
  if (id === me.id && (body.data.active === false || (body.data.role && body.data.role !== 'admin'))) {
    return c.json({ error: 'You cannot deactivate or demote yourself' }, 400);
  }
  await db(c.env.DB).update(schema.users).set(body.data).where(eq(schema.users.id, id));
  if (body.data.active === false) await destroyAllSessions(c.env, id);
  const [u] = await db(c.env.DB).select().from(schema.users).where(eq(schema.users.id, id));
  if (!u) return c.json({ error: 'Not found' }, 404);
  return c.json({ user: toPublic(u) });
});

userRoutes.post('/:id/reset-password', async (c) => {
  const body = await parseBody(c, resetPasswordSchema);
  if (!body.ok) return body.response;
  const id = c.req.param('id');
  await db(c.env.DB)
    .update(schema.users)
    .set({ passwordHash: await hashPassword(body.data.temporaryPassword), mustChangePassword: true })
    .where(eq(schema.users.id, id));
  await destroyAllSessions(c.env, id);
  return c.json({ ok: true });
});
