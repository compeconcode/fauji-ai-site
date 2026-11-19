/* fauji.ai service worker.
   Rule: the page and its scripts always come from the network when online, so a tunnel address patched into the
   page by the watchdog is picked up straight away. The saved copy is used only when the phone is offline
   (the app then opens, but cannot answer: the model runs on the GPU server).
   This worker never touches calls to the chatbot server (cross-origin, POST): chat, upload and feedback are untouched. */
const CACHE = 'fauji-pwa-v1';
const CDN_HOST = 'cdnjs.cloudflare.com';       // marked.min.js (versioned file, safe to keep)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req, url));
  else if (url.hostname === CDN_HOST) e.respondWith(cacheFirst(req));
  // anything else (the chatbot server) is not handled here
});

async function networkFirst(req, url) {
  const key = url.origin + url.pathname;        // no query string, so "?ts=..." reloads do not fill the cache
  try {
    const res = await fetch(url.href, { cache: 'no-cache' });
    if (res.redirected && req.mode === 'navigate') return Response.redirect(res.url, 302);
    if (res.ok) { const c = await caches.open(CACHE); await c.put(key, res.clone()); }
    return res;
  } catch (err) {
    const hit = await caches.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') { const c = await caches.open(CACHE); await c.put(req, res.clone()); }
  return res;
}
