/* SKRiMPAD M2 — service worker.
 *
 * The studio is a single self-contained index.html with no external
 * requests at runtime, so "offline" only needs the document, the icons
 * and the manifest. Everything is precached on install; after the first
 * visit the app opens with the network off, which is the whole point of
 * adding it to an iPad home screen.
 *
 * Bump CACHE when the app changes — the old cache is dropped on activate.
 */

const CACHE = 'skrimpad-m2-v1';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      // A single failed entry would reject the whole addAll and leave the
      // worker uninstalled, so each request is allowed to fail on its own.
      .then(cache =>
        Promise.all(
          PRECACHE.map(url =>
            cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations are network-first so a redeploy is picked up while online,
  // falling back to the cached document when the iPad is offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() =>
          caches
            .match('./index.html')
            .then(hit => hit || caches.match('./'))
        )
    );
    return;
  }

  // Static assets are cache-first — they only change with a CACHE bump.
  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
