---
"@monotykamary/localterm-server": patch
---

Give the WS heartbeat one grace ping before terminating on a stale `lastPongAt`.

When the heartbeat interval fired past the idle threshold, the previous code
terminated the socket immediately, before sending a fresh ping. On a laptop
wake this was a false positive: `Date.now()` had advanced during sleep (RTC
keeps running), so `idleMs` was already minutes past the 60s timeout, even
though the loopback socket itself was still alive — the connection just never
got a chance to prove it. The symptom was visible terminal sessions getting
terminated and reconnecting shortly after the machine woke up.

Now when the idle threshold trips, the server sends one fresh ping and waits
`WS_HEARTBEAT_GRACE_MS` (15s) for a pong before terminating. A live socket
pongs inside the grace window and the session survives; a genuinely
half-open one stays silent and terminates on the next tick — about one extra
interval of lag for dead-connection teardown, which is well within the
tolerance of the existing teardown path.

This became noticeably more frequent after the move from `ws://127.0.0.1`
to `wss://localterm.localhost` (portless on :443): the TLS/H2 session layer
in the proxy adds extra failure surfaces for half-open connections, so the
same stale-`lastPongAt` trap fires more often than it did over plain
loopback.
