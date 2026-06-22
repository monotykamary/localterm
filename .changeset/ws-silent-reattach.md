---
"@monotykamary/localterm": patch
---

Suppress connection-lost/reconnected markers on successful PTY reattach.

With 2.12.0's `SessionReattachPool`, a transient WS drop (portless teardown on
laptop wake, brief network blip) no longer kills the PTY — the server parks it
behind a `sid` and a reconnecting client with `?sid=` reattaches to the same
live shell. But the client was still unconditionally writing
`[connection lost · code 1006]` on close and `[reconnected]` on the new WS
open, because those markers predated the reattach pool and fired before the
new session frame could confirm whether the PTY survived.

This broke interactive CLIs mid-keystroke: a `vim` editing session would see
both markers injected into the buffer on every wake, corrupting the screen
state even though the underlying PTY was fine.

Now the client defers the connection-lost marker/modal on a close that has a
`liveSessionId` (shell might be parked server-side) and waits for the
reconnect's `{type:"session"}` frame:

- **Same `id` echoed back** → silent reattach succeeded. No markers, no modal.
  The screen stays exactly as the user left it; a mid-keystroke interactive
  CLI continues uninterrupted.
- **Different `id`** → grace expired, server spawned a fresh shell. Write the
  deferred `[connection lost · code X]` marker honestly so the user can tell
  where the prior shell ended and the fresh prompt began. No modal — the
  user's already at a usable prompt and can keep working.
- **Silent reconnect itself closes** (daemon genuinely down) → fall through to
  the existing connection-lost modal path with the stashed close info.

The markers still surface honestly when reattach actually fails — the noise
suppression is strictly for the case where the shell provably survived.
