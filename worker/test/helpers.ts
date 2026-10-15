import { SELF } from 'cloudflare:test';

export const BASE = 'http://calendar.test';

export interface Res<T = any> {
  status: number;
  body: T;
  cookie: string;
}

export async function call<T = any>(method: string, path: string, body?: unknown, cookie = ''): Promise<Res<T>> {
  const res = await SELF.fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, cookie: res.headers.get('set-cookie') ?? '' };
}

const sessionCookie = (setCookie: string) => setCookie.split(';')[0] ?? '';

export interface Team {
  admin: string;
  editor: string;
  viewer: string;
  ids: { admin: string; editor: string; viewer: string };
}

let team: Promise<Team> | null = null;

/** First admin + an editor and a viewer who have changed their temporary passwords. Once per test file. */
export function setupTeam(): Promise<Team> {
  team ??= (async () => {
    const setup = await call('POST', '/api/auth/setup', { email: 'admin@test.com', name: 'Asha Admin', password: 'adminpass1' });
    if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
    const admin = sessionCookie(setup.cookie);
    const ids = { admin: setup.body.user.id as string, editor: '', viewer: '' };
    const cookies: Record<string, string> = {};
    for (const role of ['editor', 'viewer'] as const) {
      const created = await call('POST', '/api/users', { email: `${role}@test.com`, name: `${role[0]!.toUpperCase()}${role.slice(1)} Person`, role, temporaryPassword: 'temp12345' }, admin);
      ids[role] = created.body.user.id;
      const login = await call('POST', '/api/auth/login', { email: `${role}@test.com`, password: 'temp12345' });
      const changed = await call('POST', '/api/auth/change-password', { currentPassword: 'temp12345', newPassword: `${role}pass99` }, sessionCookie(login.cookie));
      cookies[role] = sessionCookie(changed.cookie);
    }
    return { admin, editor: cookies.editor!, viewer: cookies.viewer!, ids };
  })();
  return team;
}

export function uuid(): string {
  return crypto.randomUUID();
}
