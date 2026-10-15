import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const BASE = 'http://calendar.test';

async function json(res: Response) {
  return { status: res.status, body: (await res.json()) as any, cookie: res.headers.get('set-cookie') ?? '' };
}
function post(path: string, body: unknown, cookie = '') {
  return SELF.fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
function get(path: string, cookie = '') {
  return SELF.fetch(`${BASE}${path}`, { headers: { cookie } });
}
function sessionCookie(setCookie: string): string {
  return setCookie.split(';')[0] ?? '';
}

describe('auth', () => {
  it('reports needsSetup on an empty database and refuses login', async () => {
    const status = await json(await get('/api/auth/status'));
    expect(status.body).toMatchObject({ needsSetup: true, user: null });
    const login = await json(await post('/api/auth/login', { email: 'nobody@test.com', password: 'x' }));
    expect(login.status).toBe(401);
  });

  it('bootstraps the first admin once, then logs in, forces password change for new users and gates roles', async () => {
    const setup = await json(await post('/api/auth/setup', { email: 'Admin@Test.com', name: 'Admin', password: 'password1' }));
    expect(setup.status).toBe(201);
    expect(setup.body.user).toMatchObject({ email: 'admin@test.com', role: 'admin', mustChangePassword: false });
    const adminCookie = sessionCookie(setup.cookie);
    expect(adminCookie).toMatch(/^koochie_calendar_session=/);
    expect(setup.cookie).toMatch(/HttpOnly/);

    // Second setup attempt is refused.
    expect((await post('/api/auth/setup', { email: 'x@test.com', name: 'X', password: 'password1' })).status).toBe(409);

    // Session works; tampered cookie does not.
    expect((await json(await get('/api/auth/me', adminCookie))).body.user.email).toBe('admin@test.com');
    expect((await get('/api/auth/me', adminCookie.slice(0, -2) + 'zz')).status).toBe(401);

    // Wrong password.
    expect((await post('/api/auth/login', { email: 'admin@test.com', password: 'nope' })).status).toBe(401);

    // Admin creates an editor with a temporary password.
    const created = await json(await post('/api/users', { email: 'editor@test.com', name: 'Editor', role: 'editor', temporaryPassword: 'temp12345' }, adminCookie));
    expect(created.status).toBe(201);
    expect(created.body.user.mustChangePassword).toBe(true);

    // Sales user logs in but is blocked until the password is changed.
    const login = await json(await post('/api/auth/login', { email: 'editor@test.com', password: 'temp12345' }));
    expect(login.status).toBe(200);
    const editorCookie = sessionCookie(login.cookie);
    const blocked = await json(await get('/api/users', editorCookie));
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await json(await post('/api/auth/change-password', { currentPassword: 'temp12345', newPassword: 'mynewpass1' }, editorCookie));
    expect(changed.status).toBe(200);
    const editorCookie2 = sessionCookie(changed.cookie);
    expect((await json(await get('/api/auth/me', editorCookie2))).body.user.mustChangePassword).toBe(false);

    // Sales cannot manage users; admin can list them.
    expect((await get('/api/users', editorCookie2)).status).toBe(403);
    const list = await json(await get('/api/users', adminCookie));
    expect(list.body.users.map((u: any) => u.email).sort()).toEqual(['admin@test.com', 'editor@test.com']);

    // Deactivation kills the session.
    const editorId = created.body.user.id;
    await SELF.fetch(`${BASE}/api/users/${editorId}`, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie: adminCookie }, body: JSON.stringify({ active: false }) });
    expect((await get('/api/auth/me', editorCookie2)).status).toBe(401);
    expect((await post('/api/auth/login', { email: 'editor@test.com', password: 'mynewpass1' })).status).toBe(403);

    // Logout clears the session.
    await post('/api/auth/logout', {}, adminCookie);
    expect((await get('/api/auth/me', adminCookie)).status).toBe(401);
  });

  it('validates bodies and responds 404 on unknown API routes', async () => {
    const bad = await json(await post('/api/auth/login', { email: 'not-an-email' }));
    expect(bad.status).toBe(400);
    expect((await get('/api/nope')).status).toBe(404);
    const health = await json(await get('/api/health'));
    expect(health.body.ok).toBe(true);
  });
});
