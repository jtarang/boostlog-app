// boostLog service worker — app-shell caching for the installable PWA.
// Bump CACHE to invalidate old caches on deploy.
const CACHE = 'boostlog-v1';
const APP_SHELL = '/app';

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.add(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // Live data must never be served stale: let /api and /token hit the network.
    if (url.origin === self.location.origin &&
        (url.pathname.startsWith('/api') || url.pathname === '/token')) {
        return;
    }

    // Navigations: try network, fall back to the cached app shell when offline.
    if (req.mode === 'navigate') {
        event.respondWith(fetch(req).catch(() => caches.match(APP_SHELL)));
        return;
    }

    // Same-origin static assets: stale-while-revalidate for instant loads.
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.open(CACHE).then(async (cache) => {
                const cached = await cache.match(req);
                const network = fetch(req).then((res) => {
                    if (res && res.status === 200) cache.put(req, res.clone());
                    return res;
                }).catch(() => cached);
                return cached || network;
            })
        );
    }
    // Cross-origin (CDN libs/fonts): leave to the browser's default network handling.
});
