// Minimal service worker: its only job is to make the page installable.
// The game ships all its code and assets locally, so there is nothing to pre-cache here.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
