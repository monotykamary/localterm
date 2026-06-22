---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

Detach PTY lifetime from the WS so a transient disconnect no longer kills the shell.

Previously a WS close — anything from a portless teardown on laptop wake to a
brief network blip — called `session.dispose()` in `onClose`, killing the PTY
with the socket. A reconnecting client spawned a brand-new shell at the same
cwd; the user's screen, in-flight command, and scrollback were gone. This was
the actual root cause of the "terminals exiting on sleep" symptom the
portless move surfaced: portless's WS proxy destroys both halves of its
two-socket pipe on any side's `close`/`error`/`end` during wake, which
appears to the daemon as an abrupt `code=1006 wasClean=false` — and the PTY
died with it.

Now a WS close parks the still-live Session behind a server-generated `sid`
(included in the `{type:"session"}` message, forwarded back as `?sid=` by the
client on reconnect) for a grace window. A fresh WS opening with the
matching `?sid=` reattaches the live PTY: same pid, same shell, same
scrollback from the page's perspective. The grace window (`SESSION_GRACE_MS`,
30s) is the disposal trigger for genuinely abandoned sessions (tab closed,
crash, network gone) — sized to cover the post-wake reconnect handshake
(the PTY itself survives sleep, suspended with the OS; only the WS dies).

This works for the portless-on-sleep case specifically because the PTY is a
child of the daemon and freezes/resumes with it — only the proxy's TCP
plumbing tears down on wake. The grace window bridges the ~1-2s between
portless surfacing the close and the browser's reconnect landing.

Park/claim/expire/exit semantics live in a new `SessionReattachPool`.
misses (grace elapsed, shell exited while parked, unknown sid) all fall
through to a fresh spawn — there is no failure mode where a `?sid=` reconnect
gets rejected.
