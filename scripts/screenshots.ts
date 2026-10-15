// Playwright tour of a running dev server → tmp/screens/*.png. Usage: npm run screenshots -- [--url …] [--only today,planner]
// Uses the preinstalled Chromium (PLAYWRIGHT_BROWSERS_PATH / CHROMIUM_PATH) or a local Chrome; never downloads one.
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright-core';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const BASE = arg('url', 'http://localhost:5173');
const only = arg('only', '').split(',').filter(Boolean);
const OUT = 'tmp/screens';
mkdirSync(OUT, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH ?? (process.env.PLAYWRIGHT_BROWSERS_PATH ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` : undefined);
const browser = await chromium.launch(executablePath ? { executablePath } : { channel: 'chrome' });

async function login(email: string, password: string, dark = false): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('header nav');
  return page;
}

const shots: [string, (p: Page) => Promise<void>][] = [
  ['today', async (p) => { await p.goto(`${BASE}/`); await p.waitForSelector('text=Hide done'); await p.waitForTimeout(400); }],
  ['today-all', async (p) => { await p.goto(`${BASE}/`); await p.getByRole('button', { name: 'Everyone' }).click(); await p.waitForTimeout(300); }],
  ['planner', async (p) => { await p.goto(`${BASE}/planner`); await p.waitForTimeout(800); }],
  ['planner-week', async (p) => { await p.goto(`${BASE}/planner`); await p.getByRole('button', { name: 'Week' }).click(); await p.waitForTimeout(500); }],
  ['planner-month', async (p) => { await p.goto(`${BASE}/planner`); await p.getByRole('button', { name: 'Month' }).click(); await p.waitForTimeout(500); }],
  ['projects', async (p) => { await p.goto(`${BASE}/projects`); await p.waitForTimeout(400); }],
  ['new-project', async (p) => { await p.goto(`${BASE}/projects`); await p.getByRole('button', { name: '+ New project' }).click(); await p.waitForTimeout(600); }],
  ['catalogue', async (p) => { await p.goto(`${BASE}/catalogue`); await p.locator('button[aria-label="Show steps"]').first().click(); await p.waitForTimeout(300); }],
  ['users', async (p) => { await p.goto(`${BASE}/admin/users`); await p.waitForTimeout(300); }],
];

const admin = await login(arg('email', 'admin@test.com'), arg('password', 'adminpass1'));
for (const [name, go] of shots) {
  if (only.length && !only.includes(name)) continue;
  await go(admin);
  await admin.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`${OUT}/${name}.png`);
}
if (!only.length || only.includes('dark')) {
  const dark = await login(arg('email', 'admin@test.com'), arg('password', 'adminpass1'), true);
  await dark.evaluate(() => { localStorage.setItem('koochie-theme', 'dark'); });
  for (const path of ['/', '/planner']) {
    await dark.goto(`${BASE}${path}`);
    await dark.waitForTimeout(700);
    const file = `${OUT}/dark-${path === '/' ? 'today' : 'planner'}.png`;
    await dark.screenshot({ path: file });
    console.log(file);
  }
}
await browser.close();
