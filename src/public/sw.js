// =============================================================================
// FOUNDRY — Service Worker
// Shell caching for offline resilience. Network-first for dynamic content.
// =============================================================================

const CACHE_NAME = 'foundry-shell-v1';

// Static assets to cache immediately on install
const SHELL_ASSETS = [
  '/static/owner.css',
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
        // ONE SURFACE, SO ONE OFFLINE PAGE.
        //
        // This branched: `/foundry` got the owner's offline page, and every
        // other path got a second one built on the commercial layout's
        // stylesheet — an em-dash on a dark ground, in a typeface and palette
        // that were never his. That branch made sense while two products
        // shared a hostname. They no longer do: the commercial pages are
        // deleted, the root is a redirect into the owner's instance, and the
        // only other thing a browser can navigate to here is the sign-in form.
        //
        // So there is one page, and it carries its own style rather than
        // linking one. A cached stylesheet is exactly the asset most likely to
        // be missing in the moment this page is needed, and the fallback for a
        // missing stylesheet was two undefined custom properties — grey text
        // on whatever ground the browser chose.
        return new Response(
          `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">`
          + `<meta name="viewport" content="width=device-width,initial-scale=1">`
          + `<title>Foundry</title><style>`
          + `:root{color-scheme:light dark}`
          + `body{margin:0;min-height:100vh;display:flex;align-items:center;`
          + `justify-content:center;background:#F3F4F1;color:#151C18;`
          + `font:400 17px/1.5 ui-sans-serif,system-ui,-apple-system,sans-serif}`
          + `main{max-width:22rem;padding:24px;text-align:left}`
          + `h1{font-family:"Iowan Old Style",Palatino,Georgia,serif;`
          + `font-size:1.5rem;font-weight:500;margin:0 0 12px}`
          + `p{color:#4C554E;margin:0}`
          + `@media (prefers-color-scheme:dark){body{background:#0D1310;color:#EAEFEA}`
          + `p{color:#A8B2AA}}`
          + `</style></head><body><main>`
          + `<h1>You are offline.</h1>`
          + `<p>Nothing of yours has changed, and I have not acted on anything. `
          + `This page will work again when you have a connection.</p>`
          + `</main></body></html>`,
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
