// Network-only worker: room state and media require the running server.
// Remove old shell/media caches so upgrades cannot resurrect stale clients.
self.addEventListener('install', event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key.startsWith('sharemusic-shell-')).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
// Intentionally no fetch interception: HTTP errors, audio Range requests, and
// offline network errors retain their native behavior. Never substitute HTML.
