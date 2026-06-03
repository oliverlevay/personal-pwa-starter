// Deterministic per-worktree dev ports. Each git worktree (a distinct absolute path)
// hashes to its own backend/frontend/e2e ports, so several worktrees can run `npm run
// dev`/e2e at the same time without colliding — and the same worktree always reuses the
// same ports (stable URLs to bookmark). Production sets PORT explicitly and ignores this.
import crypto from 'node:crypto';

export interface DevPorts {
  backend: number;
  frontend: number;
  e2e: number;
}

export function derivePorts(rootDir: string): DevPorts {
  const h = parseInt(crypto.createHash('sha1').update(rootDir).digest('hex').slice(0, 6), 16);
  const offset = h % 2000; // shared offset keeps a worktree's three ports in lockstep
  return {
    backend: 3000 + offset, // 3000–4999
    frontend: 5000 + offset, // 5000–6999
    e2e: 8000 + offset, // 8000–9999
  };
}
