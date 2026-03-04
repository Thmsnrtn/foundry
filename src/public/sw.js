// =============================================================================
// FOUNDRY — Service Worker
// Shell caching for offline resilience. Network-first for dynamic content.
// =============================================================================

const CACHE_NAME = 'foundry-shell-v1';

// Static assets to cache immediately on install
const SHELL_ASSETS = [
  '/static/styles.css',
  '/manifest.json',
];

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS).catch(() => {
        // Fail silently — app still works without cache
      });
    })
  );
  self.skipWaiting();
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// ─── Fetch ────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, cross-origin, and API requests — always network
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/internal/')
  ) {
    return;
  }

  // Static assets: cache-first
  if (url.pathname.startsWith('/static/') || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests: network-first, fall back to offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // On network failure for navigation, serve a minimal offline indicator
        return new Response(
          `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Foundry — Offline</title><link rel="stylesheet" href="/static/styles.css"></head><body><div style="display:flex;align-items:center;justify-content:center;min-height:100vh;flex-direction:column;gap:1rem;"><div style="font-size:3rem;font-weight:800;color:var(--text-dim)">—</div><p style="color:var(--text-muted)">No connection. Foundry will resume when you're back online.</p></div></body></html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }
});

// ─── Push Notifications ───────────────────────────────────────────────────────

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'Foundry', body: event.data.text(), url: '/dashboard' };
  }

  const options = {
    body: payload.body ?? '',
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    tag: payload.tag ?? 'foundry-signal',
    data: { url: payload.url ?? '/dashboard' },
    requireInteraction: payload.requireInteraction ?? false,
  };

  event.waitUntil(
    self.registration.showNotification(payload.title ?? 'Foundry', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    })
  );
});
