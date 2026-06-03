import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { derivePorts } from '../backend/lib/ports.ts';

// Per-worktree dev ports (parallel-safe across git worktrees). Vite serves the SPA and
// proxies /api to the matching backend; in prod the backend serves frontend/dist directly.
const root = path.resolve(import.meta.dirname, '..');
const { backend, frontend } = derivePorts(root);

export default defineConfig({
  plugins: [react()],
  server: {
    port: frontend,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${backend}`, changeOrigin: true },
    },
  },
});
