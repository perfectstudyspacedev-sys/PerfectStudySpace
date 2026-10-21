// PSS-AI P2.1 — the student portal's service worker (scope /me). It makes the portal installable
// and opens its pages offline from the last copy. It never caches API calls or other sites: only
// same-origin GETs for the portal's own pages and built files.
const CACHE = 'pss-portal-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('pss-portal-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return
  const isPage = req.mode === 'navigate' && (url.pathname === '/me' || url.pathname.startsWith('/me/'))
  const isAsset = url.pathname.startsWith('/assets/') || url.pathname === '/pss-logo.png' || url.pathname === '/manifest.webmanifest'
  if (!isPage && !isAsset) return
  // Network first, so a new version shows at once; the cached copy only when offline.
  event.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(isPage ? '/me' : req, copy)) }
    return res
  }).catch(() => caches.match(isPage ? '/me' : req).then((hit) => hit ?? Response.error())))
})
