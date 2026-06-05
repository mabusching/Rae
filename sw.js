/**
 * sw.js — Service Worker for offline PWA support
 * Caches all static assets on install, serves from cache first
 */

const CACHE_NAME = 'rae-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/styles/base.css',
  '/styles/survey.css',
  '/styles/dashboard.css',
  '/lib/qrcode.min.js',
  '/lib/jsQR.min.js',
  '/src/crypto.js',
  '/src/storage.js',
  '/src/domains.js',
  '/src/identity.js',
  '/src/divergence.js',
  '/src/webrtc.js',
  '/src/ui/app.js',
  '/src/ui/onboarding.js',
  '/src/ui/dashboard.js',
  '/src/ui/survey.js',
  '/src/ui/pass3.js',
  '/src/ui/connect.js',
];

// ── INSTALL ───────────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  // Only handle same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request).then((response) => {
        // Cache successful responses
        if (response.ok) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── MESSAGES ──────────────────────────────────────────────────────────────────

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') {
    self.skipWaiting();
  }
});
