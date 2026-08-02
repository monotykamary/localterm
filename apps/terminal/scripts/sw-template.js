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

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (
    data.type !== "show-session-notification" ||
    typeof data.title !== "string" ||
    typeof data.body !== "string" ||
    typeof data.tag !== "string" ||
    typeof data.sessionId !== "string" ||
    typeof data.hasViewers !== "boolean" ||
    !event.source?.id
  ) {
    return;
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      data: {
        sid: data.sessionId,
        hasViewers: data.hasViewers,
        sourceClientId: event.source.id,
      },
    }),
  );
});

// Clicking a desktop notification the SW showed (via registration.showNotification
// from the page) should open the emitting terminal. WindowClient.focus() — unlike
// a main-thread window.focus() from a Notification onclick — is the API browsers
// honor to raise a background tab, which is why notifications are shown through
// the SW registration. The page suppresses the notification in profiles that
// don't host the session, so a click lands in the right profile and focuses the
// tab there; an orphaned session (no viewer anywhere) reopens in a fresh tab.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const sid = data.sid;
  // `hasViewers` is a snapshot from emit time. Default to true when absent
  // (older notification) so we never open a second client on a viewed session.
  const hasViewers = data.hasViewers !== false;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const own = clients.filter((client) => new URL(client.url).origin === self.location.origin);
      const onSession = sid
        ? own.find((client) => new URL(client.url).searchParams.get("sid") === sid)
        : undefined;
      if (onSession) {
        await onSession.focus();
        onSession.postMessage({ type: "focus-session", sid });
        return;
      }
      if (hasViewers) {
        const sourceClient = data.sourceClientId
          ? await self.clients.get(data.sourceClientId)
          : undefined;
        const target =
          sourceClient && new URL(sourceClient.url).origin === self.location.origin
            ? sourceClient
            : own[0];
        if (target) {
          await target.focus();
          if (sid && sourceClient) target.postMessage({ type: "focus-session", sid });
        }
        return;
      }
      // Orphaned (no viewer anywhere): open a fresh tab seeded with ?sid= so it
      // attaches to the right PTY on load, rather than repurposing a tab in use.
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
