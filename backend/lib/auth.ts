// Simple auth (KISS): shared password -> HMAC-signed session cookie. Zero-dep (node:crypto).
// Single-user personal-app default; swap this file for Google/OAuth if an app needs accounts.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { config } from './config.ts';

const COOKIE = 'pwa_session';
const MAX_AGE = 60 * 60 * 24 * 60; // 60 days
const SUBJECT = 'user'; // single identity; becomes the login name for multi-user variants

// Token shape: "<subject>.<exp>.<hmac>"
function sign(subject: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const body = `${subject}.${exp}`;
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [subject, exp, mac] = parts as [string, string, string];
  const expect = crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${subject}.${exp}`)
    .digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
  return subject;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

// Logged-in subject, or null. When APP_PASSWORD is unset we treat the app as open
// (dev convenience) — never deploy without setting it.
export function currentUser(req: IncomingMessage): string | null {
  if (!config.appPassword) return SUBJECT;
  return verify(parseCookies(req)[COOKIE]);
}

export function checkPassword(pw: unknown): boolean {
  if (!config.appPassword) return true;
  if (typeof pw !== 'string' || pw.length !== config.appPassword.length) return false;
  return crypto.timingSafeEqual(Buffer.from(pw), Buffer.from(config.appPassword));
}

export function sessionCookie(): string {
  return `${COOKIE}=${sign(SUBJECT)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

// Inbox (Cloudflare worker) reaches the server without a login cookie -> token-guarded.
// No weak default: unset token = inbox disabled (security over convenience).
export function inboxEnabled(): boolean {
  return !!config.inboxToken;
}

export function checkInboxToken(token: unknown): boolean {
  if (!config.inboxToken || typeof token !== 'string' || token.length !== config.inboxToken.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.inboxToken));
}
