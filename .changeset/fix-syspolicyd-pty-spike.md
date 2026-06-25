---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Cut the per-PTY syspolicyd spike and restore the portless surface for automation run tabs.

The launchd-managed daemon spiked syspolicyd to ~30% on every PTY open because the plist baked the full user `PATH` (added in 2.12.0 so the daemon could find `portless`), which leaked into the PTY login shell and the daemon's own `git`. A launchd agent has no GUI provenance, so the ad-hoc Homebrew binaries that mise/direnv bootstrapped (`direnv`, `git`) were re-assessed by syspolicyd per prompt — ~207 violates / 621 SecKeyVerify per PTY, never cached. Pre-2.12.0 the plist set only `HOME`, so the daemon ran on launchd's minimal `/usr/bin:/bin` and the spike was ~3/9.

Three changes restore the pre-portless behaviour without losing the portless surface:

- The plist now bakes a minimal system PATH plus the daemon's own `node` dir and `portless` dir (captured at `localterm install`). The daemon still finds `portless` (named `.localhost` URLs) and `node`, but no longer pulls Homebrew/mise onto its PATH. User shells bootstrap their own tools via rc files like any login shell, and now resolve the correct mise-managed `node` instead of Homebrew's. `LOCALTERM_PTY_FULL_PATH=1` opts back into the old leaky behaviour.
- The daemon's `git` (diff summaries, repo detection on every PTY) now resolves to `/usr/bin/git` (Apple-signed, cached regardless of provenance) when it's a real git, falling back to PATH-resolved `git` where `/usr/bin/git` is only the Xcode shim.
- `isProxyLive` (the portless liveness probe) now checks both `127.0.0.1` and `::1` on `:443`. portless's network extension serves loopback on IPv6, so the old IPv4-only probe timed out and the daemon fell back to the loopback URL even when portless was healthy — automation run tabs opened at `http://localterm.localhost:<port>` instead of `https://localterm.localhost`. Re-run `localterm install` to rewrite the plist, then restart.

Also fixes a pre-existing parse error in `automations-api.test.ts` (a stray `"` where a backtick was meant left a template literal unclosed), which had prevented the "automation run tab surface" suite from running since 2.13.0.
