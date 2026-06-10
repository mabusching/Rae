/**
 * sw.js — Service Worker for offline PWA support
 *
 * Paths are derived from self.location so this works correctly
 * whether hosted at root (/) or a subdirectory (/rae/ on GitHub Pages).
 */

const CACHE_NAME = 'rae-v6';

// Derive base path from SW location — handles both root and subdir hosting
// e.g. https://user.github.io/rae/sw.js → base = '/rae'
const SW_PATH = self.location.pathname;
const BASE = SW_PATH.substring(0, SW_PATH.lastIndexOf('/'));

function url(path) {
  return BASE + path;
}

const STATIC_ASSETS = [
  BASE + '/',
  url('/index.html'),
  url('/manifest.json'),
  url('/styles/base.css'),
  url('/styles/survey.css'),
  url('/styles/dashboard.css'),
  url('/lib/qrcode.min.js'),
  url('/lib/jsQR.min.js'),
  url('/src/crypto.js'),
  url('/src/storage.js'),
  url('/src/domains.js'),
  url('/src/identity.js'),
  url('/src/divergence.js'),
  url('/src/ui/app.js'),
  url('/src/ui/onboarding.js'),
  url('/src/ui/dashboard.js'),
  url('/src/ui/survey.js'),
  url('/src/ui/pass3.js'),
  url('/src/ui/connect.js'),
  url('/src/ui/ideal.js'),
  url('/icons/icon-192.png'),
  url('/icons/icon-512.png'),
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
          return caches.match(url('/index.html'));
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
