import { Hono } from 'hono';
import { eq, sql } from 'drizzle-orm';
import { db, newId, nowIso, schema } from '../db/client';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSession, destroySession, destroyAllSessions, readSession, toPublic } from '../auth/session';
import { requireAuth, type AppEnv } from '../auth/middleware';
import { changePasswordSchema, loginSchema, setupSchema } from '@shared/schemas/auth';
import { parseBody } from './util';

export const authRoutes = new Hono<AppEnv>();

async function userCount(d1: D1Database): Promise<number> {
  const [row] = await db(d1).select({ n: sql<number>`count(*)` }).from(schema.users);
  return Number(row?.n ?? 0);
}

/** Tells the SPA whether the first-admin setup screen should be shown, and who is signed in. */
authRoutes.get('/status', async (c) => {
  const needsSetup = (await userCount(c.env.DB)) === 0;
  const user = needsSetup ? null : await readSession(c);
  return c.json({ needsSetup, user, appName: c.env.APP_NAME });
});

/** Bootstrap: creates the first admin. Only works while the users table is empty. */
authRoutes.post('/setup', async (c) => {
  if ((await userCount(c.env.DB)) > 0) return c.json({ error: 'Setup already completed' }, 409);
  const body = await parseBody(c, setupSchema);
  if (!body.ok) return body.response;
  const id = newId();
  await db(c.env.DB).insert(schema.users).values({
    id,
    email: body.data.email,
    name: body.data.name,
    role: 'admin',
    passwordHash: await hashPassword(body.data.password),
    mustChangePassword: false,
    active: true,
    createdAt: nowIso(),
    lastLoginAt: nowIso(),
  });
  await createSession(c, id);
  const [u] = await db(c.env.DB).select().from(schema.users).where(eq(schema.users.id, id));
  return c.json({ user: u && toPublic(u) }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await parseBody(c, loginSchema);
  if (!body.ok) return body.response;
  const [u] = await db(c.env.DB).select().from(schema.users).where(eq(schema.users.email, body.data.email)).limit(1);
  const ok = u ? await verifyPassword(body.data.password, u.passwordHash) : false;
  if (!u || !ok) return c.json({ error: 'Invalid email or password' }, 401);
  if (!u.active) return c.json({ error: 'This account is deactivated' }, 403);
  await db(c.env.DB).update(schema.users).set({ lastLoginAt: nowIso() }).where(eq(schema.users.id, u.id));
  await createSession(c, u.id);
  return c.json({ user: toPublic({ ...u, lastLoginAt: nowIso() }) });
});

authRoutes.post('/logout', async (c) => {
  const user = await readSession(c);
  await destroySession(c, user?.sessionId);
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth({ allowPending: true }), (c) => c.json({ user: c.get('user') }));

authRoutes.post('/change-password', requireAuth({ allowPending: true }), async (c) => {
  const body = await parseBody(c, changePasswordSchema);
  if (!body.ok) return body.response;
  const user = c.get('user');
  const [u] = await db(c.env.DB).select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1);
  if (!u || !(await verifyPassword(body.data.currentPassword, u.passwordHash))) {
    return c.json({ error: 'Current password is incorrect' }, 400);
  }
  await db(c.env.DB)
    .update(schema.users)
    .set({ passwordHash: await hashPassword(body.data.newPassword), mustChangePassword: false })
    .where(eq(schema.users.id, user.id));
  // Sign out other devices, keep this one.
  await destroyAllSessions(c.env, user.id);
  await createSession(c, user.id);
  return c.json({ ok: true });
});
