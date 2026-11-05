// Minimal service worker: makes the app installable and keeps the app shell
// available offline. API calls and map tiles always go to the network.
const CACHE = 'poschanger-v4';
const SHELL = [
  './',
  'index.html',
  'config.js',
  'css/app.css',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/leaflet.js',
  'js/app.js',
  'js/api.js',
  'js/dom.js',
  'js/format.js',
  'js/map.js',
  'js/chart.js',
  'js/shared/geo.js',
  'js/shared/motion.js',
  'js/views/auth.js',
  'js/views/connect.js',
  'js/views/main.js',
  'js/views/trip.js',
  'js/views/circles.js',
  'js/views/reconnect.js',
  'js/views/settings.js',
  'js/views/admin.js',
  'icons/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  // Network first, so updates show up immediately; cache as an offline fallback.
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html'))),
  );
});
