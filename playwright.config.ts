import { defineConfig } from '@playwright/test';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { derivePorts } from './backend/lib/ports.ts';

// Per-worktree e2e port + an isolated temp DB, so e2e can run from several worktrees at
// once (and alongside the dev servers, which use different ports). Playwright builds the
// frontend and starts the real backend serving it.
const { e2e: PORT } = derivePorts(import.meta.dirname);
const DATA_DIR = path.join(os.tmpdir(), `pwa-e2e-${PORT}`);
fs.mkdirSync(DATA_DIR, { recursive: true });

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm --prefix frontend run build && node --disable-warning=ExperimentalWarning backend/server.ts',
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT), DATA_DIR, APP_PASSWORD: '' },
  },
});
