import { Hono } from 'hono';
import type { AppEnv } from './auth/middleware';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { userRoutes } from './routes/users';
import { planRoutes, todayRoutes } from './routes/plan';
import { projectRoutes } from './routes/projects';
import { taskRoutes } from './routes/tasks';
import { catalogRoutes } from './routes/catalog';
import { linkRoutes } from './routes/links';
import { errorResponse } from './services/http-error';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
});

app.route('/api/health', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/plan', planRoutes);
app.route('/api/today', todayRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/catalog', catalogRoutes);
app.route('/api/links', linkRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  // Anything else falls through to Static Assets (SPA index.html via not_found_handling).
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError(errorResponse);

export default app;
