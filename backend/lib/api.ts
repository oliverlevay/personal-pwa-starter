// REST router: built-in endpoints (me, push, chat, inbox) + a generic CRUD surface
// driven by an allowlist of store tables (DRY/open-closed). The app composes an
// `AppRoutes` and edits the resource list / hooks rather than this file.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Store } from './store.ts';
import type { Pusher, PushSubscription } from './push.ts';
import * as auth from './auth.ts';

export interface AppRoutes {
  store: Store;
  pusher: Pusher;
  chat?: (req: IncomingMessage, res: ServerResponse, user: string | null) => Promise<void>;
  inbox?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  resources?: string[]; // store tables exposed via generic CRUD
}

const MAX_BODY = 8 * 1024 * 1024;

function send(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const buf = Buffer.concat(chunks);
        resolve(buf.length ? JSON.parse(buf.toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

// Returns true if the request was an /api/* route (handled here), else false.
export async function handleApi(
  app: AppRoutes,
  req: IncomingMessage,
  res: ServerResponse,
  user: string | null,
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return false;
  const seg = parts.slice(1);
  const method = req.method || 'GET';

  try {
    // /api/inbox/:token — reached without a login cookie (CF worker); token-guarded.
    if (seg[0] === 'inbox') {
      if (!app.inbox || !auth.inboxEnabled()) return send(res, 503, { error: 'Inbox not configured.' }), true;
      if (method !== 'POST' || !auth.checkInboxToken(seg[1])) return send(res, 403, { error: 'Invalid token' }), true;
      await app.inbox(req, res);
      return true;
    }

    // Everything below requires a session.
    if (!user) return send(res, 401, { error: 'Not authenticated' }), true;

    // /api/me
    if (seg[0] === 'me' && seg.length === 1) {
      if (method === 'GET') return send(res, 200, { user }), true;
    }

    // /api/push/(key|subscribe|unsubscribe|test)
    if (seg[0] === 'push') {
      if (seg[1] === 'key' && method === 'GET') return send(res, 200, { publicKey: app.pusher.publicKey() }), true;
      if (seg[1] === 'subscribe' && method === 'POST') {
        app.pusher.subscribe((await readJson(req)) as unknown as PushSubscription);
        return send(res, 201, { ok: true }), true;
      }
      if (seg[1] === 'unsubscribe' && method === 'POST') {
        const body = (await readJson(req)) as { endpoint?: string };
        if (body.endpoint) app.pusher.unsubscribe(body.endpoint);
        return send(res, 200, { ok: true }), true;
      }
      if (seg[1] === 'test' && method === 'POST') {
        const sent = await app.pusher.notify({ title: 'Test notification', body: 'Web Push is working 🎉' });
        return send(res, 200, { sent }), true;
      }
    }

    // /api/chat
    if (seg[0] === 'chat' && seg.length === 1 && method === 'POST') {
      if (!app.chat) return send(res, 503, { error: 'Chat not configured.' }), true;
      await app.chat(req, res, user);
      return true;
    }

    // Generic CRUD: /api/:type[/:id], restricted to the resource allowlist.
    const type = seg[0];
    if (type && (app.resources || []).includes(type)) {
      const id = seg[1];
      if (!id) {
        if (method === 'GET') return send(res, 200, app.store.list(type, { orderBy: 'created_at DESC' })), true;
        if (method === 'POST') return send(res, 201, app.store.insert(type, await readJson(req))), true;
      } else {
        if (method === 'GET') {
          const x = app.store.find(type, id);
          return send(res, x ? 200 : 404, x || { error: 'not found' }), true;
        }
        if (method === 'PATCH' || method === 'PUT') {
          const x = app.store.update(type, id, await readJson(req));
          return send(res, x ? 200 : 404, x || { error: 'not found' }), true;
        }
        if (method === 'DELETE') return send(res, 200, { ok: app.store.remove(type, id) }), true;
      }
    }

    send(res, 404, { error: 'unknown endpoint' });
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send(res, message === 'too large' ? 413 : 400, { error: message });
    return true;
  }
}
