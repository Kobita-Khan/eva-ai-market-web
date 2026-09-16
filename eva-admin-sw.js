// Legacy compatibility worker. The admin PWA now uses the shared safe shell worker.
// No API responses, authentication pages, admin pages, or customer data are cached here.
const CACHE='eva-admin-static-v2';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('eva-admin-static-')&&key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',()=>{});
