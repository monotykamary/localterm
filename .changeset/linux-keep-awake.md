---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Keep-awake (the coffee button), its battery floor, and the chrome://inspect bootstrap now work on Linux as well as macOS.

- Keep-awake on Linux uses `systemd-inhibit --what=idle:sleep:handle-lid-switch --mode=block tail -f /dev/null` instead of `caffeinate -dims`. The spawned `systemd-inhibit` runs detached in its own process group so a group-kill releases the inhibitor and reaps the orphaned `tail` cleanly — the lock is tied to `systemd-inhibit`'s D-Bus lifetime, so killing it always releases the assertion. Support is gated on `systemd-inhibit` being on PATH, so the coffee button hides on non-systemd/minimal hosts instead of spawning a no-op. `tail -f /dev/null` is the portable blocker (coreutils + busybox; `sleep infinity` is GNU-coreutils-only).
- The battery floor now reads `/sys/class/power_supply/<dev>/{type,capacity,status,time_to_empty_now}` on Linux (no `upower`/`acpi` dependency), gating on `type === "Battery"`; `pmset -g batt` stays the macOS path. Both fail-open to `null` so a desktop or a transient read error never wedges keep-awake off.
- The "Inspect" button's chrome://inspect launcher on Linux invokes the detected browser binary directly (`google-chrome`, `chromium`, `brave-browser`, …) with the URL — `xdg-open` has no `chrome://` scheme handler, so the prior OS-opener fallback was a silent no-op. A running Chromium reuses its instance's profile and opens a new tab, matching what the macOS AppleScript achieves. Priority order matches the DevToolsActivePort scan.
