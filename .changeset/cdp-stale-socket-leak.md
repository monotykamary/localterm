---
"@monotykamary/localterm-server": patch
---

Close the persistent CDP WebSocket explicitly when `openBackgroundTab`'s
`Target.createTarget` call rejects, instead of just unassigning `this.ws`.

Previously the catch flagged the socket as gone by setting `this.ws = undefined`
and `connectedBrowser = undefined`, but never called `.close()` on the abandoned
`WebSocket`. When the call rejected via a `callTimeoutMs` timeout while the
socket was still `OPEN` (the common case — the browser hadn't dropped the
connection, it just never replied), the live socket was leaked. The next
`connect()` then opened a *second* live socket alongside the orphaned one, and
the ambient token/handler maps kept stale entries from the dead session.

The fix routes teardown through `failPending` (which clears the token↔targetId
maps and event handlers in one place) after explicitly `close()`-ing the stale
socket. `failPending`'s `if (this.ws !== ws) return` guard makes this safe
against a concurrent reconnect that already swapped in a fresh socket between
the timeout firing and the catch running.
