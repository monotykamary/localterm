// Template for dist/sw.js. The precache list and shell version are injected at
// build time by scripts/generate-sw.mjs — edit this file, not the generated one.
const SHELL_VERSION = "__SW_VERSION__";
const PRECACHE_URLS = JSON.parse(__PRECACHE_URLS_JSON__);

const PRECACHE = `localterm-shell-v${SHELL_VERSION}`;
const SHELL_URL = "/";

const isShellAsset = (request, url) =>
  request.method === "GET" &&
  url.origin === self.location.origin &&
  !url.pathname.startsWith("/api/") &&
  url.pathname !== "/ws";

const fromCacheOrNetwork = async (request) => {
  const cache = await caches.open(PRECACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Cache each entry independently so one stale build artifact can't abort
      // the whole install (addAll would roll back the entire precache on a 404).
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            await cache.add(url);
          } catch {
            /* skip transient 404s between builds */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== PRECACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (!isShellAsset(request, url)) return;

  if (request.mode === "navigate") {
    // Network-first so a running daemon always serves the latest shell, with
    // the precached app shell as the offline fallback.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(PRECACHE);
          cache.put(SHELL_URL, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(PRECACHE);
          return (await cache.match(SHELL_URL)) || (await cache.match(request)) || Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(fromCacheOrNetwork(request).catch(() => Response.error()));
});
