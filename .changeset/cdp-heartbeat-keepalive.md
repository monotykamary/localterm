---
"@monotykamary/localterm-server": patch
---

Keep the persistent CDP socket alive across sleep/wake so automations stop re-prompting for the browser's remote-debugging connection.

The daemon opens exactly one CDP WebSocket at `start` (so you clear the browser's one-time remote-debugging prompt a single time) and is meant to reuse it for every automation run. But the socket had no keepalive: after a laptop sleep the loopback socket usually survives with the OS while the wall clock jumps, so `isConnected()` still reported `OPEN` yet the next `Target.createTarget` call stalled for the full call timeout and then tore the socket down — the subsequent reconnect opened a *fresh* socket and re-triggered the debugging prompt. That is why automations appeared to re-prompt the CDP connection instead of reusing the one localterm started with.

The client now runs a heartbeat mirroring the PTY WS keepalive: any inbound CDP frame (reply or unsolicited `Target` event) refreshes a liveness timestamp; after a quiet window the heartbeat probes with a cheap `Target.getTargets` round-trip rather than assuming death. A live-but-silent socket replies and is reused — no reopen, no re-prompt. A genuinely half-open socket leaves the probe unanswered past the call timeout and is torn down proactively, so the next run reconnects cleanly instead of stalling `createTarget` for five seconds first.
