---
"@monotykamary/localterm": patch
---

Fix the favicon getting stuck on green (blue never shown) after a silent WebSocket reattach — a regression introduced in 2.37.2's attach-time foreground re-seed. That re-seed cleared the pending favicon ready-timer on every session frame, so on a same-PTY reattach (any connection blip — common over tailscale/DERP) the green→blue quiet transition was interrupted: with the foreground process quiet, no output re-armed the timer, `checkReadyAfterOutput` never fired, and the icon stayed green forever. The re-seed now only drops the favicon timers on a genuine switch to a different PTY, leaves them running on a same-PTY reattach, and never clobbers an active "running" (green) state.
