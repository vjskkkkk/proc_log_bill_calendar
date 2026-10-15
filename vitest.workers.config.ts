import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';

const SECRET = 'integration-test-secret';

/** Fake BOQ Maker: the contract of koochie-boq's GET /api/integration/planner/quotes (403 without the secret). */
const BOQ_QUOTES = [
  { id: 'q-r1', rootQuoteId: 'q-root1', quoteNo: 'KS/2026/0101', displayNo: 'KS/2026/0101 R1', revision: 1, status: 'won', quoteType: 'sports', clientCompany: 'Prestige Lakeside', clientName: 'Mr. Rao', projectName: 'Clubhouse courts', location: 'Whitefield, Bengaluru', crmLeadId: 'lead1', pdfIssuedAt: '2026-10-01T08:00:00.000Z' },
  { id: 'q-2', rootQuoteId: 'q-2', quoteNo: 'KS/2026/0102', displayNo: 'KS/2026/0102', revision: 0, status: 'pdf_issued', quoteType: 'terralux', clientCompany: 'DLF 5 Lake Park', clientName: 'Anita Gupta', projectName: 'Lake Park', location: 'Gurugram', crmLeadId: null, pdfIssuedAt: '2026-10-05T08:00:00.000Z' },
];
async function fakeBoq(request: Request): Promise<Response> {
  if (request.headers.get('X-Integration-Secret') !== SECRET) return new Response('{"error":"Forbidden"}', { status: 403 });
  const url = new URL(request.url);
  if (url.pathname === '/api/integration/planner/quotes') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    return Response.json({ quotes: BOQ_QUOTES.filter((x) => !q || JSON.stringify(x).toLowerCase().includes(q)) });
  }
  return new Response('{"error":"Not found"}', { status: 404 });
}

/** Fake CRM: the contract of yourcrm's GET /api/integration/leads. */
async function fakeCrm(request: Request): Promise<Response> {
  if (request.headers.get('X-Integration-Secret') !== SECRET) return new Response('{"error":"forbidden"}', { status: 403 });
  if (new URL(request.url).pathname === '/api/integration/leads') {
    return Response.json({
      leads: [
        { id: 'lead1', company: 'Prestige Lakeside', contact: 'Mr. Rao', product: 'Sports Infra', stage: 9, outcome: 'won' },
        { id: 'lead2', company: 'Sobha Dream Acres', contact: 'Ms. Iyer', product: 'Sports Infra', stage: 4, outcome: '' },
        { id: 'lead3', company: 'Brigade Orchards', contact: 'Mr. Shah', product: 'Sports Infra', stage: 9, outcome: 'lost' },
      ],
    });
  }
  return new Response('{"error":"not found"}', { status: 404 });
}

// Worker project: Hono routes run inside workerd against an isolated local D1 (migrations applied per test file).
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    resolve: { alias: { '@shared': path.join(import.meta.dirname, 'shared') } },
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations, SESSION_SECRET: 'test-secret', COOKIE_SECURE: 'false', INTEGRATION_SECRET: SECRET },
          // Stand in for the koochie-boq and yourcrm Workers (worker/routes/links.test.ts).
          serviceBindings: { BOQ: fakeBoq, CRM: fakeCrm },
        },
      }),
    ],
    test: {
      name: 'worker',
      include: ['worker/**/*.test.ts'],
      exclude: ['worker/services/**/*.test.ts'],
      setupFiles: ['./worker/test/apply-migrations.ts'],
    },
  };
});
