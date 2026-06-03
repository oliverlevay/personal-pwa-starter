// Service worker: offline caching (from oliver-och-klara-i-japan) + Web Push (from
// valentina). Bump VERSION to invalidate the runtime cache on deploy.
const VERSION = 'pwa-starter-v1';
const SHELL = '/';

// ── PWA install/activate ──────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.add(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ── Runtime caching ───────────────────────────────────────────────
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return; // mutations always hit the network
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Navigations -> network-first, fall back to the cached shell so routes work offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const c = res.clone();
          caches.open(VERSION).then((x) => x.put(SHELL, c));
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  // API GETs -> network-first with cache fallback (data readable offline).
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const c = res.clone();
          caches.open(VERSION).then((x) => x.put(request, c));
          return res;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  // Other same-origin assets -> cache-first with background update.
  e.respondWith(
    caches.match(request).then((cached) => {
      const net = fetch(request)
        .then((res) => {
          if (res.ok) {
            const c = res.clone();
            caches.open(VERSION).then((x) => x.put(request, c));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    }),
  );
});

// ── Web Push ──────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = data.title || 'PWA Starter';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icons/icon-192.png', // large, full-color
      badge: '/icons/badge-96.png', // small, MUST be monochrome+transparent (Android tints it)
      tag: data.tag || 'pwa-starter',
      renotify: true,
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
