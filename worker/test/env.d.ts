/// <reference types="@cloudflare/vitest-pool-workers/types" />
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import type { Env as WorkerBindings } from '../env';

// cloudflare:test exposes `env: Cloudflare.Env`; give it our bindings plus the migration list.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerBindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
