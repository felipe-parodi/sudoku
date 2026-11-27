'use strict';
/* Sudoku service worker — cache-first, so the app runs fully offline.
   Bump VERSION (and app.js VERSION) on every deploy; installed phones pick
   the update up the next time they open the app online. */
const VERSION = 'v1.1.0';
const CACHE = 'sudoku-' + VERSION;
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './sudoku.js', './gen-worker.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await self.clients.claim();
    const keys = await caches.keys();
    // pipeparodi.com hosts other apps (Spotter…) on the same origin — only touch our own caches
    await Promise.all(keys.filter(k => k.startsWith('sudoku-') && k !== CACHE).map(k => caches.delete(k)));
  })());
});

self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      if (e.request.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
