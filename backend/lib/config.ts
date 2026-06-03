// Central, typed env access (KISS version of bokur2's EnvironmentVariables).
// Required vars throw at startup so misconfig fails fast; optional ones have defaults.
import path from 'node:path';
import { derivePorts } from './ports.ts';

function opt(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

// backend/lib -> repo root; data lives on the (Railway) volume next to the code.
const ROOT = path.join(import.meta.dirname, '..', '..');

export const config = {
  // Dev: a stable port derived from this worktree's path (parallel-safe). Prod: PORT env.
  port: Number(process.env.PORT ?? derivePorts(ROOT).backend),
  dataDir: opt('DATA_DIR', path.join(ROOT, 'data')),

  // Shared-password auth (single-user personal app). Empty = auth open in dev only.
  appPassword: opt('APP_PASSWORD', ''),
  sessionSecret: opt('SESSION_SECRET', 'dev-insecure-change-me'),

  // Claude chat. Empty disables the /api/chat endpoint.
  anthropicApiKey: opt('ANTHROPIC_API_KEY', ''),
  anthropicModel: opt('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),

  // Web Push. VAPID keypair is auto-seeded into the store on first run; only the
  // contact subject is configurable (required by the spec, any mailto/https URL).
  vapidSubject: opt('VAPID_SUBJECT', 'mailto:admin@example.com'),

  // Receipt/email inbox (Cloudflare worker posts here). Empty = inbox disabled.
  inboxToken: opt('INBOX_TOKEN', ''),
};

export type Config = typeof config;
