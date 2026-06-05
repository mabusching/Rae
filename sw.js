// sw.js

const CACHE_NAME = 'rae-v1';

// 1. Identify the subdirectory path dynamically
// If hosted at username.github.io/repository-name/sw.js, 
// basePath becomes "/repository-name/"
const basePath = self.location.pathname.substring(0, self.location.pathname.lastIndexOf('/') + 1);

// 2. Define assets strictly relative to the application structure (no leading slashes)
const RELATIVE_ASSETS = [
  '',
  'index.html',
  'manifest.json',
  'styles/base.css',
  'styles/survey.css',
  'styles/dashboard.css',
  'lib/qrcode.min.js',
  'lib/jsQR.min.js',
  'src/crypto.js',
  'src/storage.js',
  'src/domains.js',
  'src/identity.js',
  'src/divergence.js',
  'src/webrtc.js',
  'src/ui/app.js',
  'src/ui/onboarding.js',
  'src/ui/dashboard.js',
  'src/ui/survey.js',
  'src/ui/pass3.js',
  'src/ui/connect.js',
];

// 3. Map the assets to the dynamic base path so cache.addAll gets the absolute URLs it requires
const STATIC_ASSETS = RELATIVE_ASSETS.map(asset => `${basePath}${asset}`);

// ── INSTALL ───────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── FETCH ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  if (!event.request.url.startsWith(self.location.origin)) return;
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
        // Use the dynamic fallback path for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match(`${basePath}index.html`);
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
