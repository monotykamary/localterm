---
"@monotykamary/localterm": patch
---

Stop `localterm install` crying wolf about `portless service install` when the proxy is already running.

`setupPortlessProxy` ran `portless service install` unconditionally, and that subcommand fails spuriously on machines where the proxy is already installed (it shells out to BSD `install` and dumps its usage banner), so every `localterm install` printed `⚠ portless service failed: Command failed: portless service install` even though `:443` was healthy. It now treats a live proxy as the source of truth: when `isProxyLive` (`:443`) is already true it skips the install and reports `✔ proxy already running`; otherwise it attempts the install and re-checks liveness before warning, so a genuine "proxy not running" still surfaces but the existing-install false-failure stays silent.
