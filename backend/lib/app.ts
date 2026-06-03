// App composition + request handling, separated from the process entry point (server.ts)
// so tests can boot an isolated instance on an ephemeral port with its own SQLite file.
// This is the file an app edits: register migrations, resources, chat tools, inbox here.
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteStore } from './store.ts';
import { createPusher, PUSH_MIGRATION } from './push.ts';
import { createChatHandler } from './chat.ts';
import { createInboxHandler } from './inbox.ts';
import { handleApi, type AppRoutes } from './api.ts';
import * as auth from './auth.ts';

export interface BuiltApp {
  routes: AppRoutes;
  store: SqliteStore;
}

// Build the store + services + routes for one instance. Pass a dataDir so tests isolate.
export function createApp(dataDir: string): BuiltApp {
  const store = new SqliteStore(path.join(dataDir, 'app.db'));
  store.migrate([
    PUSH_MIGRATION,
    {
      id: 'app_0001_notes',
      sql: `CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT,
        body TEXT,
        created_at TEXT,
        updated_at TEXT
      );`,
    },
  ]);

  const pusher = createPusher(store);

  // Demo chat: a concise assistant that can also push the user a notification (shows how
  // to wire chat tool-calls into a service). Apps replace the prompt + tools — e.g. the
  // finance app exposes SQL-over-transactions tools here.
  const chat = createChatHandler({
    system: () =>
      'You are a helpful assistant inside a personal PWA. Answer concisely. ' +
      'You can send the user a push notification with the send_notification tool — use it ' +
      'when they ask to be reminded or notified of something.',
    tools: [
      {
        name: 'send_notification',
        description:
          "Send a push notification to the user's devices. Use when the user asks to be reminded or notified.",
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short notification title' },
            body: { type: 'string', description: 'Notification body text' },
          },
          required: ['title'],
        },
      },
    ],
    runTool: async (name, input) => {
      if (name === 'send_notification') {
        const sent = await pusher.notify({
          title: String(input.title || 'Reminder'),
          body: input.body ? String(input.body) : '',
        });
        return `Notification sent to ${sent} device(s).`;
      }
      return `Unknown tool: ${name}`;
    },
  });

  // Demo inbox: reports what arrived. Apps store + analyze the files here.
  const inbox = createInboxHandler(async (email) => ({
    from: email.from,
    files: email.files.map((f) => ({ filename: f.filename, bytes: f.bytes.length })),
  }));

  const routes: AppRoutes = { store, pusher, chat, inbox, resources: ['notes'] };
  return { routes, store };
}

// ── Static SPA serving ────────────────────────────────────────────
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

function safeJoin(base: string, urlPath: string): string | null {
  const p = path.join(base, path.normalize(urlPath));
  return p.startsWith(base) ? p : null;
}

function sendFile(res: ServerResponse, filePath: string): void {
  const ext = path.extname(filePath).toLowerCase();
  // Vite content-hashes /assets/* -> cache hard; index.html must revalidate (PWA shell).
  const cache = filePath.includes(`${path.sep}assets${path.sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
  res.end(fs.readFileSync(filePath));
}

function serveStatic(res: ServerResponse, urlPath: string, spaDir: string): void {
  const index = path.join(spaDir, 'index.html');
  const sendIndex = (): void => {
    if (isFile(index)) return sendFile(res, index);
    res.writeHead(503);
    res.end('SPA not built — run `npm run build` in frontend/.');
  };
  if (urlPath === '/') return sendIndex();
  const sp = safeJoin(spaDir, urlPath);
  if (sp && isFile(sp)) return sendFile(res, sp);
  sendIndex(); // unknown path -> SPA route, let the client router handle it
}

function json(res: ServerResponse, code: number, obj: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(obj));
}

function readLoginBody(req: IncomingMessage): Promise<{ password?: string }> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// The HTTP request handler: auth endpoints, /api/*, then static SPA.
export function makeRequestListener(routes: AppRoutes, spaDir: string) {
  return async function listener(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const pathname = decodeURIComponent((req.url || '').split('?')[0] || '');

    if (pathname === '/api/login' && req.method === 'POST') {
      const { password } = await readLoginBody(req);
      if (!auth.checkPassword(password)) return json(res, 401, { error: 'Wrong password' });
      return json(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie() });
    }
    if (pathname === '/api/logout' && req.method === 'POST') {
      return json(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
    }
    if (pathname === '/api/health') return json(res, 200, { ok: true });

    if (pathname.startsWith('/api/')) {
      await handleApi(routes, req, res, auth.currentUser(req));
      return;
    }

    serveStatic(res, pathname, spaDir);
  };
}

// Convenience for tests: a ready http.Server (not yet listening) backed by a fresh store.
export function createServer(dataDir: string, spaDir: string): { server: http.Server; built: BuiltApp } {
  const built = createApp(dataDir);
  const server = http.createServer(makeRequestListener(built.routes, spaDir));
  return { server, built };
}
