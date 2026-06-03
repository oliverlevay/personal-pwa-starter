// Web Push behind a small interface (DIP boundary). Mirrors valentina's proven setup:
// VAPID keypair auto-seeded into the store on first run (so subscriptions survive
// restarts with zero config), encrypted {title, body} payloads via the `web-push` lib.
// `web-push` is the one accepted npm dependency — hand-rolling RFC 8291 crypto is the
// opposite of KISS, and the spec is frozen so the lib's age is low-risk.
import webpush from 'web-push';
import crypto from 'node:crypto';
import type { Store } from './store.ts';
import { config } from './config.ts';

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body?: string;
  [extra: string]: unknown; // e.g. url to open, tag — read by the service worker
}

export interface Pusher {
  publicKey(): string;
  subscribe(sub: PushSubscription): void;
  unsubscribe(endpoint: string): void;
  notify(payload: PushPayload): Promise<number>; // returns # delivered
}

// Scaffold-owned table; the server applies this alongside each app's own migrations.
export const PUSH_MIGRATION = {
  id: 'scaffold_0001_push_subscriptions',
  sql: `CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );`,
};

interface SubRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function createPusher(store: Store): Pusher {
  let pub = store.getConfig('vapid_public');
  let priv = store.getConfig('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    store.setConfig('vapid_public', pub);
    store.setConfig('vapid_private', priv);
  }
  webpush.setVapidDetails(config.vapidSubject, pub, priv);

  return {
    publicKey: () => pub!,

    subscribe(sub) {
      store.run(
        `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at`,
        [crypto.randomUUID(), sub.endpoint, sub.keys.p256dh, sub.keys.auth, iso(), iso()],
      );
    },

    unsubscribe(endpoint) {
      store.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
    },

    async notify(payload) {
      const subs = store.all<SubRow>('SELECT id, endpoint, p256dh, auth FROM push_subscriptions');
      const body = JSON.stringify(payload);
      let delivered = 0;
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              body,
            );
            delivered++;
          } catch (err) {
            // 404/410 = subscription gone (uninstalled/expired) -> prune it.
            const code = (err as { statusCode?: number }).statusCode;
            if (code === 404 || code === 410) {
              store.run('DELETE FROM push_subscriptions WHERE id = ?', [s.id]);
            }
          }
        }),
      );
      return delivered;
    },
  };
}

const iso = (): string => new Date().toISOString();
