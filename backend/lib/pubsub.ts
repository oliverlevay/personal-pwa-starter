// In-memory SSE pub/sub for live multi-device sync (single process — fine for one
// Railway instance). Keyed by conversation id -> subscriber SSE responses. The sender's
// clientId is excluded so a device doesn't get echoed its own events. Ported from
// oliver-och-klara-i-japan's lib/pubsub.ts.
import type { ServerResponse } from 'node:http';

interface Subscriber {
  res: ServerResponse;
  clientId: string;
}

const channels = new Map<string, Set<Subscriber>>();

// Subscribe an SSE response to a channel; returns an unsubscribe fn.
export function subscribe(key: string, res: ServerResponse, clientId: string): () => void {
  let set = channels.get(key);
  if (!set) {
    set = new Set();
    channels.set(key, set);
  }
  const sub: Subscriber = { res, clientId };
  set.add(sub);
  return () => {
    set!.delete(sub);
    if (set!.size === 0) channels.delete(key);
  };
}

// Broadcast an event to a channel's subscribers, skipping the originating client.
export function publish(key: string, event: unknown, exceptClientId?: string): void {
  const set = channels.get(key);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const sub of set) {
    if (exceptClientId && sub.clientId === exceptClientId) continue;
    try {
      sub.res.write(data);
    } catch {
      /* connection closed — unsubscribe happens on its own 'close' */
    }
  }
}
