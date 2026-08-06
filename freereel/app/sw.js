/* FREEREEL service worker — offline-first for the app shell.
 *
 * The catalogue ships inside the bundle, so once the shell is cached the whole
 * app works with no connection. Outbound links (platforms, the "free right
 * now?" lookup) obviously still need one. */

var CACHE = 'freereel-v1';

var SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './data.js',
  './icon.svg',
  './manifest.webmanifest',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch outbound links

  /* Network-first for the shell so a redeploy is picked up promptly, falling
     back to cache when offline. */
  e.respondWith(
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
  );
});
