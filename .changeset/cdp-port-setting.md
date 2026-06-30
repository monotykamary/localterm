---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add a configurable CDP remote-debugging port for automation background tabs, plus
Aside support and a manual Connect action.

The daemon's CDP client auto-detected a debug-enabled Chromium by scanning known
user-data dirs for a `DevToolsActivePort` file. Aside was missing from that list,
so it was never found even though it writes the file into
`~/Library/Application Support/Aside`. It's now a candidate on macOS/Linux/Windows,
so auto-detect picks it up (the most-recently-launched browser still wins, as
before). A new daemon config (`~/.localterm/config.json`, `cdpPort`) pins a
specific port. When set, discovery probes `GET /json/version` first, then falls
back to a `DevToolsActivePort` file matching that port — the only reliable path
for browsers that don't serve `/json/version` (Chrome 144+, Dia, Aside),
mirroring browser-harness-js's `resolveWsUrlFromPort`. The configured port is
preferred; the file scan remains as fallback when it refuses the connection.

- New `GET`/`PUT /api/config` reads and updates `cdpPort`. A `PUT` persists it and
  updates the live port value the daemon reads on the next connect — it does
  NOT tear down or reconnect (that's the explicit Connect button's job, or the
  startup connect), so changing the port never disrupts a working connection or
  flashes "Not connected". `/api/health`'s `cdp` field gains an optional `port`
  for the connected browser.
- The terminal Settings modal has a new "Automation browser" section with a port
  field (empty = auto-detect) and a live "Connected — <browser>" / "Not
  connected" status. It is a daemon-global value hydrated on modal open, not a
  per-tab localStorage pref. A **Connect** button triggers an explicit, awaited
  `POST /api/cdp/connect` that surfaces the failure reason (e.g. a timed-out
  handshake hinting at an unaccepted remote-debugging prompt) instead of the
  fire-and-forget connect kicked by the port change and daemon start.
- `localterm start` and `localterm install` probe the configured port so their
  banners name the right browser.
