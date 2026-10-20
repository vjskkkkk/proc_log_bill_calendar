// Fills a LOCAL dev server with demo projects and tasks through the API (never point this at production).
// Usage: npm run seed:demo -- [--url http://localhost:5173] [--email admin@test.com] [--password adminpass1] [--size small|large]
// Creates the first admin if the database is empty, plus two editors (password demopass1) to own tasks.
import { addDays, todayIST } from '../shared/schedule/dates';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const BASE = arg('url', 'http://localhost:5173');
const EMAIL = arg('email', 'admin@test.com');
const PASSWORD = arg('password', 'adminpass1');
const SIZE = arg('size', 'small');
if (!/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error('seed:demo only runs against a local dev server.');
  process.exit(1);
}

let cookie = '';
async function call(method: string, path: string, body?: unknown, as = cookie): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), cookie: as },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && as === cookie) cookie = set.split(';')[0]!;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok && res.status !== 409) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return data;
}

const status = await call('GET', '/api/auth/status');
if (status.needsSetup) await call('POST', '/api/auth/setup', { email: EMAIL, name: 'Vikram Admin', password: PASSWORD });
else await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });

const people: Record<string, string> = {};
for (const [email, name] of [['priya@test.com', 'Priya Nair'], ['rahul@test.com', 'Rahul Verma']] as const) {
  const created = await call('POST', '/api/users', { email, name, role: 'editor', temporaryPassword: 'demopass1' });
  if (created?.user) {
    // Sign in once and set the permanent password so the account is usable.
    const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'demopass1' }) });
    const c = login.headers.get('set-cookie')!.split(';')[0]!;
    await fetch(`${BASE}/api/auth/change-password`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: c }, body: JSON.stringify({ currentPassword: 'demopass1', newPassword: 'demopass1!' }) });
  }
}
const plan = await call('GET', '/api/plan');
for (const p of plan.people) people[p.name.split(' ')[0]!.toLowerCase()] = p.id;
const me = plan.people.find((p: any) => p.role === 'admin')?.id;
const owners = [me, people.priya, people.rahul].filter(Boolean) as string[];

const T = todayIST();
const d = (n: number) => addDays(T, n);
const uuid = () => crypto.randomUUID();

const SITES = [
  ['Prestige Lakeside — Clubhouse courts', 'Prestige Group', 'Whitefield, Bengaluru'],
  ['DLF 5 — Lake Park TerraLux', 'DLF Ltd', 'Gurugram'],
  ['Sobha Dream Acres — Multi-sport arena', 'Sobha Ltd', 'Panathur, Bengaluru'],
  ['Brigade Orchards — Box cricket', 'Brigade Enterprises', 'Devanahalli'],
  ['DPS North — Basketball & futsal', 'Delhi Public School', 'Yelahanka, Bengaluru'],
  ['Godrej Woods — Pickleball x4', 'Godrej Properties', 'Noida'],
];
const count = SIZE === 'large' ? 40 : SITES.length;

for (let i = 0; i < count; i++) {
  const [name, client, location] = SITES[i % SITES.length]!;
  const shift = (i % SITES.length) * 4 - 10 + Math.floor(i / SITES.length) * 21;
  const project = await call('POST', '/api/projects', { name: i < SITES.length ? name : `${name} (phase ${Math.floor(i / SITES.length) + 1})`, client, location });
  const pid = project.project.id;
  const own = (k: number) => owners[(i + k) % owners.length];
  // Task List tasks: their sub-tasks are added undated (chained by their dependencies), then some get dates.
  const turf = uuid();
  const turfRes = await call('POST', '/api/tasks', { id: turf, projectId: pid, title: 'Artificial turf', catalogItemId: 'tl-m-turf', startDate: d(shift - 6), endDate: d(shift + 12), assigneeId: own(0) });
  const steps = turfRes.tasks.filter((t: any) => t.parentId === turf);
  const stepDates: [number, number][] = [[-6, -4], [-4, -1], [0, 1], [1, 2], [3, 10], [11, 12]];
  for (const [k, s] of steps.entries()) {
    const [a, b] = stepDates[k] ?? [0, 0];
    await call('PATCH', `/api/tasks/${s.id}`, { startDate: d(shift + a), endDate: d(shift + b), ...(k === 1 ? { assigneeId: own(1) } : {}), ...(shift + b < 0 && k !== 1 ? { done: true } : {}) });
  }
  await call('POST', '/api/tasks', { id: uuid(), projectId: pid, title: 'Floodlights & poles', catalogItemId: 'tl-e-lights', startDate: d(shift + 2), endDate: d(shift + 16), assigneeId: own(1) });
  const dispatch = uuid();
  await call('POST', '/api/tasks', { id: dispatch, projectId: pid, title: 'Dispatch from warehouse to site', catalogItemId: 'tl-l-dispatch', addCatalogSteps: false, startDate: d(shift + 13), endDate: d(shift + 15), assigneeId: own(2) });
  await call('POST', '/api/tasks', { id: uuid(), projectId: pid, title: 'Advance invoice', category: 'billing', startDate: d(shift - 8), endDate: d(shift - 7), assigneeId: own(2) });
  // Waits for the dispatch: moves whenever the dispatch moves.
  await call('POST', '/api/tasks', { id: uuid(), projectId: pid, title: 'Dispatch invoice', category: 'billing', dependsOnId: dispatch, plannedDays: 2, assigneeId: own(0) });
  await call('POST', '/api/tasks', { id: uuid(), projectId: pid, title: 'Arrange crane for pole erection', category: 'equipment' });
}
console.log(`seed:demo — ${count} projects with tasks at ${BASE}`);
