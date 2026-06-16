---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix launchd auto-start respawn loop that caused continuous syspolicyd activity on macOS. The launchd plist now runs the daemon directly in the foreground with crash-only KeepAlive, and the start command exits cleanly when another instance is already running under launchd.
