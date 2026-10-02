// NexIDE service worker — offline support.
//
//   navigations          network-first, fall back to the cached app shell (offline)
//   /assets/*            cache-first (content-hashed, immutable)
//   /pyodide/v<ver>/*    cache-first (versioned Python runtime)
//   other same-origin    stale-while-revalidate (pyodide.worker.js, preview.html, icons)
//   /api, non-GET, cross-origin → untouched (always network)
//
// Cached responses keep their original headers, so COOP/COEP (cross-origin isolation)
// and the CSP still apply when the app is served offline.

const VERSION = 'v1';
const SHELL_CACHE = `nexide-shell-${VERSION}`;
const ASSET_CACHE = `nexide-assets-${VERSION}`;
const MAX_ASSET_ENTRIES = 400; // a few deploys' worth of hashed chunks

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => cache.add(new Request('/', { cache: 'reload' }))).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
    for (const key of await caches.keys()) {
      if (key.startsWith('nexide-') && !keep.has(key)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - MAX_ASSET_ENTRIES))) await cache.delete(req);
}

async function networkFirstNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone()); // every route serves the same SPA shell
    return response;
  } catch (err) {
    const cached = await cache.match('/');
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    trim(cache);
  }
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
  } else if (url.pathname.startsWith('/assets/') || /^\/pyodide\/v[^/]+\//.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
