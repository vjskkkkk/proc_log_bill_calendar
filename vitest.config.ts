import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Two projects: `unit` (pure Node: shared/schedule, schemas) and `worker`
// (Hono routes against real local D1 via the Workers pool; see vitest.workers.config.ts).
export default defineConfig({
  resolve: { alias: { '@shared': path.join(import.meta.dirname, 'shared') } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['shared/**/*.test.ts', 'worker/services/**/*.test.ts', 'scripts/**/*.test.ts'], environment: 'node' },
      },
      './vitest.workers.config.ts',
    ],
  },
});
