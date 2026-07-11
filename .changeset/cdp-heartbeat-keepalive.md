---
"@monotykamary/localterm-server": patch
---

Stop the CDP keepalive from tearing down a live socket on an idle probe.

The daemon's persistent CDP WebSocket has a background keepalive that probes liveness with a `Target.getTargets` round-trip after a quiet window, so a half-open socket left by a laptop sleep is torn down proactively instead of stalling the next automation run. Its `.catch` tore down the socket on ANY error — including a `CdpReplyError`, which is the browser successfully answering the probe with a CDP error result on a perfectly healthy socket. Every other teardown path (`openBackgroundTab`, `closeTab`) was patched in ec9fd0a to skip teardown on a `CdpReplyError` — a reply must never drop the one socket kept for the daemon's lifetime, or the forced reconnect re-fires the browser's remote-debugging consent prompt on every run — but the heartbeat probe was missed. Add the same guard: a CDP error reply now resets the quiet clock (via `onMessage`) and keeps the socket; only a transport drop or a probe timeout is genuinely stale.

The probe also rode on the 5s per-call timeout with no grace, so a slow-but-live browser (post-wake scheduling delay, a momentary main-thread block on a devtools fork like Dia/Arc) missed the window and lost its socket. Give the probe its own generous reply-wait — `CDP_HEARTBEAT_GRACE_MS` (15s, mirroring `WS_HEARTBEAT_GRACE_MS`'s "one grace chance before terminate") — so a live socket that's merely slow to answer is reused instead of dropped. Kept under the interval so a probe never overlaps the next tick.
