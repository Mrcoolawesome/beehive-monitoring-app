// Minimal service worker — its only job is to satisfy PWA "installability"
// (browsers require a registered service worker before they'll offer an
// install prompt) and let the static app shell (icons, manifest) open
// instantly from cache. It deliberately does NOT cache the dashboard page
// or /api/readings: this app's whole purpose is showing the latest hive
// weight, so serving a cached/stale reading would be actively misleading.
// Anything that isn't one of the static assets below just falls through to
// a normal network fetch, same as if there were no service worker at all.

const CACHE_NAME = "hive-monitor-shell-v1";

// Only files that never change based on live data — safe to cache
// aggressively. Bump CACHE_NAME above (not this list) if these ever need
// to be force-refreshed on already-installed clients.
const SHELL_ASSETS = [
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  // Activate this service worker immediately instead of waiting for the
  // previously-installed one to be closed in every open tab first.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Clean up caches from a previous CACHE_NAME (i.e. an older version of
  // this service worker), so installed clients don't accumulate stale
  // shell assets forever.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (SHELL_ASSETS.includes(url.pathname)) {
    // Cache-first: these files are static, so there's no reason to wait on
    // the network for them once they're cached.
    event.respondWith(
      caches
        .match(event.request)
        .then((cached) => cached ?? fetch(event.request)),
    );
  }
  // Everything else (the dashboard page, /api/readings, ...) is left
  // untouched — the browser handles it exactly as it would with no service
  // worker present, so live data always comes straight from the server.
});
