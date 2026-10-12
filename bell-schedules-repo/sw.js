/* Service worker for the Bell Clock web app.
   Goal: the page opens instantly and still works when the school wifi drops,
   without ever serving a stale schedule when the network is available. */

const VERSION = 'bell-v1';
const SHELL = [
  'clock.html',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'app.webmanifest'
];

self.addEventListener('install', e => {
  // Cache the shell, but do not fail the install if one file is missing.
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(SHELL.map(f => c.add(f))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isSchedule = url.pathname.endsWith('overrides.json') || url.pathname.endsWith('overrides-draft.json');

  // The page itself and the schedule file: always try the network first, so a
  // published change is picked up as soon as there is a connection. Fall back
  // to the last good copy when offline.
  if (req.mode === 'navigate' || isSchedule) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok && sameOrigin) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('clock.html')))
    );
    return;
  }

  // Icons and other static assets: cache first, they rarely change.
  if (sameOrigin) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(req, copy));
        }
        return res;
      }))
    );
  }
});
