/**
 * State of Leonida - PWA Service Worker
 * Version: 1.0.0
 */

const CACHE_NAME = 'leonida-v1';
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/landing.css',
  '/landing.js',
  '/features.css',
  '/features.js',
  '/assets/fonts/fonts.css',
  '/assets/libs/leaflet/leaflet.css',
  '/assets/libs/leaflet/leaflet.js',
  '/assets/logos/Logo.png',
  '/assets/logos/gtavi.png',
  '/assets/logos/favicon/favicon-96x96.png',
  '/assets/logos/favicon/web-app-manifest-192x192.png',
  '/assets/logos/favicon/web-app-manifest-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_ASSETS.map((url) => cache.add(url).catch((err) => console.warn('PWA precache skip:', url, err)))
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip APIs, admin, and non-GET requests from caching
  if (event.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch fresh copy in background for next time
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }
        }).catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return response;
      }).catch(() => {
        // Offline fallback to index
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
