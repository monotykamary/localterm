---
"@monotykamary/localterm": minor
---

Integrate portless for stable named `.localhost` URLs.

- `localterm install` now also sets up the portless proxy: installs the
  root-owned launchd service (HTTPS on `:443`, starts at boot) and trusts
  the local CA so browsers accept `https://*.localhost`. Both steps are
  best-effort and skipped when `portless` isn't on PATH, so installs
  without the workspace dependency are unaffected.
- `localterm start` / `restart` register a static portless route
  (`https://localterm.localhost` → the bound port) after the daemon comes
  up, and announce that URL. When portless is absent they fall back to the
  named host with port (`http://localterm.localhost:<port>`), which still
  resolves via RFC 6761.
- `localterm status` adds a `raw:` line for the literal loopback bind.
- Adds `getDirectUrl` / `getPortlessUrl` helpers alongside `getFriendlyUrl`.
- The terminal dev server runs through portless at
  `https://dev.localterm.localhost` (real `vp dev` moved to `dev:app`).
- Requires Node 24+ in the workspace (portless runtime); the published CLI
  still declares `node >=22` since it doesn't bundle portless.
