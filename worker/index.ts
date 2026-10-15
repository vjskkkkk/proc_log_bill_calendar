import { Hono } from 'hono';
import type { AppEnv } from './auth/middleware';
import { authRoutes } from './routes/auth';
import { healthRoutes } from './routes/health';
import { userRoutes } from './routes/users';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
});

app.route('/api/health', healthRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not found' }, 404);
  // Anything else falls through to Static Assets (SPA index.html via not_found_handling).
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || 'Internal error' }, 500);
});

export default app;
