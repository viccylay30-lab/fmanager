const CACHE_NAME = 'fm-pwa-cache-v14';
const ASSETS_TO_CACHE = [
  './index.html',
  './style.css',
  './app.js',
  './attributes.js',
  './injuries.js',
  './development.js',
  './match-engine.js',
  './league.js',
  './narrative.js',
  './calendar.js',
  './transfers.js',
  './loans.js',
  './manager-ai.js',
  './boardroom.js',
  './divisions.js',
  './europe.js',
  './career.js',
  './awards.js',
  './contracts.js',
  './rival-transfers.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      return cachedResponse || fetch(event.request).then((fetchResponse) => {
        return caches.open(CACHE_NAME).then((cache) => {
          if (event.request.method === 'GET' && event.request.url.startsWith('http')) {
            cache.put(event.request, fetchResponse.clone());
          }
          return fetchResponse;
        });
      });
    }).catch(() => {
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
    })
  );
});