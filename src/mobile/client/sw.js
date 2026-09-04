// Service worker — app shell only.
// ==============================================================================
//
// It caches the four static files that make up the shell and nothing else.
//
// /m1 responses are deliberately NOT cached here.  Domain data caching is the
// application's job, because DATA-MODEL §3 attaches *rules* to cache age —
// FRESH/STALE/EXPIRED decide what the user may do, not merely what they see.
// A service worker replaying a stale response would hand the app data with no
// age attached, and the app would treat it as fresh. Worse, it could serve
// content after a revocation wipe.
//
// So: shell from cache, data always from the network.
//
// ==============================================================================

const SHELL = 'is-shell-v2';
const ASSETS = ['/', '/index.html', '/app.css', '/app.js', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== SHELL).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Approval data is S2 and has its own explicit exclusion in addition to the
  // broad /m1 guard below. Keeping this invariant route-specific prevents a
  // later API-cache refactor from silently pulling the approval queue or a
  // decision response into CacheStorage.
  if (isApprovalRequest(event.request, url)) return;

  // Never intercept the API. An offline /m1 request must fail as a network
  // error so the client can classify it (SS-03) instead of silently reading
  // an old body.
  if (url.pathname.startsWith('/m1')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL).then(cache => cache.put(event.request, copy)).catch(() => {});
        }
        return response;
      })
      .catch(() => caches.match(event.request).then(hit => hit || caches.match('/index.html'))),
  );
});

function isApprovalRequest(request, url) {
  if (request.method === 'GET') {
    return url.pathname === '/m1/approvals' || url.pathname === '/m1/approvals/';
  }
  if (request.method === 'POST') {
    return /^\/m1\/approvals\/[^/]+\/decide\/?$/.test(url.pathname);
  }
  return false;
}
