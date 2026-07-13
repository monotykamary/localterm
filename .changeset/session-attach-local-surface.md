---
"@monotykamary/localterm": patch
---

Route `localterm session attach` at the daemon-local surface instead of the remote (tailnet) surface.

`runAttach` opened `resolved.url` — `resolveDaemonUrl`'s remote surface, picked tailnet-first — so a tailnet-fronted daemon opened the attach tab at `https://<node>.ts.net/?sid=…` even when an agent drove localterm from the local portless origin (`https://localterm.localhost`). `session attach` opens a tab in the daemon's own browser, the same local-context action automation run tabs perform, so it now opens at `resolved.localUrl` (portless `https://localterm.localhost`, else loopback) and never rides a flapping `tailscale serve` (laptop wake, DERP relay, cert renewal) that would fail the tab load. The remote `publicUrl` still drives the network-policy host allowlist and `localterm start --open`, so mobile/tailnet access is unchanged. The remote/local split was introduced for run tabs in the prior `mobile-run-tab-and-reattach` changeset; `session attach` was the one local-browser tab-open path it missed. Adds a regression test asserting the attach opens at the portless surface when the remote surface is the tailnet.
