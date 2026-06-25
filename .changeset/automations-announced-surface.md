---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Open automation-run tabs at the announced surface instead of the loopback URL.

Automation runs always opened at the hardcoded `http://localterm.localhost:<port>` loopback URL even when portless (or Tailscale) fronted the daemon, so a scheduled run landed on the http tab instead of `https://localterm.localhost`. The CLI now hands the daemon the surface it resolved (best-first: tailnet → portless → loopback) through a new `publicUrl` server option / `setPublicUrl` setter on `RunningServer`, and `tryLaunch` builds the run-tab URL from that origin. The CDP tab filter (`isLocaltermTabUrl`) also recognises the announced origin, so ambient-token injection and `closeOnFinish`'s CDP `closeTab` keep working behind the proxy — a portless URL carries no port and a tailnet URL is on `:443`, both of which the old `parsed.port === String(port)` check rejected.

Separately, the launchd-managed daemon still resolved to loopback even with the above, because the generated plist set only `HOME` — no `PATH` — so the daemon (launched with launchd's minimal `/usr/bin:/bin`) couldn't find the `portless` binary and `resolveDaemonUrl` fell back to loopback with a "portless not installed" warning. `buildPlistContent` now bakes the install-time `PATH` into the plist's `EnvironmentVariables` (XML-escaped), so the daemon finds `portless` (and Homebrew `git`, mise shims, etc.) the same way a foreground `localterm start` does. Re-run `localterm install` to rewrite the plist with the PATH, then restart.
