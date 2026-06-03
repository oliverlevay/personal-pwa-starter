import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit tests run in jsdom (no server, no ports) -> inherently parallel-safe across worktrees.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
