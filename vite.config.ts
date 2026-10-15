import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';
import path from 'node:path';

// One Vite config drives both the SPA (web/) and the Worker (worker/index.ts, via the Cloudflare plugin).
// `vite` = dev server with HMR + workerd (local D1); `vite build` = dist/client + dist/koochie_calendar.
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react(), tailwindcss(), cloudflare({ configPath: '../wrangler.jsonc', persistState: { path: '../.wrangler/state' } })],
  resolve: {
    alias: {
      '@shared': path.join(import.meta.dirname, 'shared'),
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
