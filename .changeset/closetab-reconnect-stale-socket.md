---
"@monotykamary/localterm-server": patch
---

`closeTab` no longer orphans a tab when Ctrl+D closes a shell while the daemon's
persistent CDP socket is momentarily down (sleep/wake, a transient WS error, or
the heartbeat tearing down a half-open socket). It was the only CDP consumer
that bailed on `!isConnected()` without reconnecting — `openBackgroundTab`,
`openForegroundTab`, and `findTargetByUrl` all re-establish the socket first — so
a **clean** shell exit landing while the debug WS was down silently skipped the
close. The client had already been told the tab was CDP-controlled, so it
deferred its `window.close()` fallback past the 1s `AMBIENT_TAB_CLOSE_DEADLINE_MS`
deadline, and on a URL-opened tab (the principal localterm open path) that
fallback is a no-op — leaving the dead-session mask behind (the "modal popup").
`closeTab` now reconnects (one retry if the close itself fails on a stale
mid-close socket), so it lands the close against the still-valid targetId the
moment the socket comes back rather than dropping it on the floor.
