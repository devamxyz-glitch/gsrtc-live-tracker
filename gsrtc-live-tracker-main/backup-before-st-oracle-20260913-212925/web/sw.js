/* ST Tracker service worker.
 *
 * Live data is never cached — a stale bus position is worse than no bus position.
 * The shell is precached so the app opens instantly and still renders (with its offline
 * copy of the last tracked bus) when the network is gone.
 */

const VERSION = 'v1.46.2';
const SHELL = `st-shell-${VERSION}`;

const SHELL_FILES = [
  './',
  'index.html',
  'privacy.html',
  'styles.css',
  'manifest.webmanifest',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'js/app.js',
  'js/api.js',
  'js/alerts.js',
  'js/events.js',
  'js/helpline.js',
  'js/home.js',
  'js/i18n.js',
  'js/permissions.js',
  'js/push.js',
  'js/install.js',
  'js/icons.js',
  'js/insight.js',
  'js/map.js',
  'js/nearby.js',
  'js/routemap.js',
  'js/routes.js',
  'js/settings.js',
  'js/stats.js',
  'js/status.js',
  'js/store.js',
  'js/tour.js',
  'js/track.js',
  'js/trip.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // addAll is all-or-nothing; add individually so one 404 cannot break the install.
    await Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live API: network only. Never serve a cached bus position.
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return;

  // Navigations: network first, shell as the fallback.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Same reasoning as networkFirst: revalidate the shell rather than trusting a
        // heuristic cache, so a deploy is never one load behind its own scripts.
        const net = await fetch(request, { cache: 'no-cache' });
        (await caches.open(SHELL)).put('index.html', net.clone());
        return net;
      } catch {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  if (url.origin === self.location.origin) {
    // App code is not content-hashed, so a cached script could outlive the markup that
    // matches it. Go to the network first and keep the cache purely as the offline copy.
    const isCode = /\.(js|mjs|css|webmanifest)$/.test(url.pathname);
    event.respondWith(isCode ? networkFirst(request) : cacheFirst(request));
  }

  // Cross-origin map tiles are deliberately left alone: they come back as opaque responses,
  // which browsers charge against the storage quota at a padded size (megabytes each), so
  // caching a pan across Gujarat would blow the origin's quota for the data we actually need.
});

async function networkFirst(request) {
  try {
    // `cache: 'no-cache'` forces a conditional request, so a long-lived HTTP cache entry
    // from an earlier deploy cannot keep serving code that no longer matches the markup.
    const res = await fetch(request, { cache: 'no-cache' });
    if (res.ok) (await caches.open(SHELL)).put(request, res.clone());
    return res;
  } catch {
    const hit = await caches.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw new Error('offline and not cached');
  }
}

/** Images and vendor bundles: serve instantly, refresh quietly in the background. */
async function cacheFirst(request) {
  const hit = await caches.match(request);
  const network = fetch(request).then((res) => {
    if (res.ok) caches.open(SHELL).then((c) => c.put(request, res.clone()));
    return res;
  }).catch(() => hit);
  return hit || network;
}

/* ------------------------------------------------------------------ push */
/**
 * An arrival alert, delivered whether or not the app is open. `userVisibleOnly` was promised
 * at subscribe time, so every push must show something — a silent one would have the
 * subscription revoked by the browser.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* fall through to defaults */ }

  const title = data.title || 'Your bus is approaching';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-96.png',
    tag: data.plate ? `st-${data.plate}` : 'st-alert',
    renotify: false,
    requireInteraction: false,
    vibrate: [120, 60, 120],
    data: { url: data.url || './' },
  }));
});

/** Focus an already-open tab rather than piling up new ones. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || './';
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      if ('focus' in client) {
        if ('navigate' in client) await client.navigate(target).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
