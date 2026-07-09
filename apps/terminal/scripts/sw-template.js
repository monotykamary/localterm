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

// Clicking a desktop notification the SW showed (via registration.showNotification
// from the page) should focus an open localterm tab and switch it to the
// emitting session. WindowClient.focus() — unlike a main-thread window.focus()
// from a Notification onclick — is the API browsers honor to raise a background
// tab, which is why notifications are shown through the SW registration. The
// page tags each notification per session so duplicate fan-out deliveries across
// the user's tabs coalesce into one OS notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const sid = event.notification.data && event.notification.data.sid;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const own = clients.filter((client) => client.url.startsWith(self.location.origin));
      // Prefer a tab already viewing this session (its URL carries ?sid=<sid>),
      // so the click just focuses it instead of switching another tab over.
      const target =
        (sid && own.find((client) => client.url.includes(`sid=${encodeURIComponent(sid)}`))) ||
        own[0];
      if (target) {
        await target.focus();
        if (sid) target.postMessage({ type: "focus-session", sid });
        return;
      }
      // No open localterm tab — open one seeded with the session so it attaches
      // to the right PTY on load (the client reads ?sid= on initial connect).
      const url = sid
        ? `${self.location.origin}/?sid=${encodeURIComponent(sid)}`
        : `${self.location.origin}/`;
      await self.clients.openWindow(url);
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
