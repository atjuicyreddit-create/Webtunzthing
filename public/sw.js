// Minimal service worker: makes the site installable. No offline caching in v1.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  /* network as normal */
});
