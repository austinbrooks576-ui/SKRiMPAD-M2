// sw.js — the whole app, kept on the device.
//
// WHY THIS IS SHORT. ULTIMATE bundles to ONE self-contained HTML file: the
// script, the styles and the display font are all inlined, and every sound the
// app makes is synthesised rather than loaded. So "install the app offline" is
// "keep four files", and the elaborate caching strategies that service workers
// are famous for have nothing here to be elaborate about.
//
// CACHE-FIRST, NOT NETWORK-FIRST, and deliberately. This is an instrument. It
// has to open on a plane, in a basement, on a phone with no signal, and it must
// never sit waiting on a network round trip before it can make a sound. The
// update check happens in the background, after the app is already running.
//
// THE VERSION IS THE CACHE NAME. Changing it is what makes an update take:
// activate() deletes every cache that is not this one, so there is no way to
// end up serving half of an old build and half of a new one.
const VERSION = 'skrimpad-ultimate-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png',
];

self.addEventListener('install', (e) => {
  // skipWaiting, because a music app that needs to be closed and reopened
  // twice before an update lands is one that never gets updated.
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Same-origin only. A cross-origin request from this app would be a bug, and
  // caching one would be a bug that persisted.
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        // Serve immediately, then quietly refresh the copy for next launch.
        // The running app is never interrupted by a download it did not ask
        // for, and the next cold start already has the new build.
        e.waitUntil(
          fetch(req).then((res) => {
            if (res && res.ok) return caches.open(VERSION).then((c) => c.put(req, res));
          }).catch(() => {})
        );
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        // Offline and not cached: a navigation still gets the app rather than
        // the browser's dinosaur, because the app is the thing that works
        // offline and refusing to show it would be absurd.
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      );
    })
  );
});
