---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": patch
---

Pair each WS socket with its CDP target for reliable tab close on shell exit.

Ctrl+D in the PTY sometimes failed to close the browser tab: the client's
`window.close()` doesn't apply to tabs the user opened by URL or via Dia/Arc's
quirky tab model, so the tab stranded with the shell already dead. Fix it by
tracking the tab provenance _ambiently_ over the WS handshake instead of relying
on the client's close.

The daemon's `CdpClient` now subscribes to `Target.setDiscoverTargets` and, for
every page-type target on its origin, injects a unique token via
`Page.addScriptToEvaluateOnNewDocument` (re-runs on every reload, so the token
survives the page's lifetime). The page echoes that token in a new
`{type:"identify"}` WS message; the server resolves it to the CDP `targetId`
and stores it on the socket. On a **clean** shell exit the same closeTab queue
that serializes automation-run closes picks up the target — concurrent Ctrl+Ds
never interleave — driving the browser's own close path via CDP (reliable where
`window.close()` isn't). The client learns whether it's CDP-controlled via a
new `{type:"cdp-controlled"}` ack and defers its own `window.close()` so the
server-driven close settles without flashing the dead-session mask; it falls
back to `window.close()` + mask if the CDP close doesn't land by the deadline.

Non-zero exit codes skip the auto-close so the dead-session mask surfaces the
failure. Tabs not on the CDP-attached browser fall back to the pre-existing
`window.close()` path with no regression.
