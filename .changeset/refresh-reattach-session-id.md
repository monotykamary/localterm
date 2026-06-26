---
"@monotykamary/localterm": patch
---

Reattach the live PTY on a tab refresh instead of spawning a fresh shell. The server already supported `?sid=` reattach (used by the session switcher and transient WS drops), but the client kept the session id only in memory and never wrote it to the URL — so a full page refresh (⌘R / F5) wiped it, opened a no-`sid` WebSocket, and the daemon spawned a new shell while the old PTY detached, sat dormant for the grace window, and got reaped. The session id is now mirrored into the address bar as `?sid=` (alongside the existing `?cwd=`) when a session frame lands, cleared on shell exit, and `buildWebSocketUrl` falls back to it on a fresh page load. The attach handshake also requests a scrollback replay when the surface is blank on a fresh load (`priorSessionId === null`), so a refresh onto a live PTY lands on its recent output instead of a blank screen — a no-op for a brand-new spawn, whose ring buffer is empty.
