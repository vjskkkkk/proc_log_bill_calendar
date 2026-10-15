import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { readSession, type SessionUser } from './session';
import type { Role } from '@shared/types';

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

/** Loads the session; 401 when absent. Routes that must work while a password change is pending pass allowPending. */
export function requireAuth(opts: { allowPending?: boolean } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = await readSession(c);
    if (!user) return c.json({ error: 'Not signed in' }, 401);
    if (user.mustChangePassword && !opts.allowPending) {
      return c.json({ error: 'Password change required', code: 'PASSWORD_CHANGE_REQUIRED' }, 403);
    }
    c.set('user', user);
    await next();
  });
}

export function requireRole(...roles: Role[]) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) return c.json({ error: 'Forbidden' }, 403);
    await next();
  });
}

/** Writes to the plan, projects and catalogue: admins and editors. Viewers get 403. */
export const canEdit = requireRole('admin', 'editor');
