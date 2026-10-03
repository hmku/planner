// Service worker for the installable app: serves the app offline.
// Network first, so a deploy shows up on the next online launch; the cache is
// only the offline fallback. Keep APP_SHELL in sync with the files index.html
// loads, and bump CACHE_VERSION when that list changes. The page is cached as
// "./" only: hosts with clean URLs redirect /index.html, and a cached redirect
// can't answer a navigation.
const CACHE_VERSION = "planner-v1";
const APP_SHELL = [
  "./",
  "styles.css",
  "app.js",
  "js/constants.js",
  "js/util.js",
  "js/format.js",
  "js/ui-shell.js",
  "js/lifestyle.js",
  "js/simulation.js",
  "js/charts.js",
  "js/results.js",
  "js/share.js",
  "js/plan-store.js",
  "js/lifestyle-ui.js",
  "data/spx-annual-returns.json",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (error) {
      // Offline: share links and other query strings still open the cached page.
      const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
      if (cached) return cached;
      if (request.mode === "navigate") return (await cache.match("./")) || Response.error();
      return Response.error();
    }
  })());
});
