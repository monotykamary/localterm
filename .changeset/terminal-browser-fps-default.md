---
"@monotykamary/localterm-server": patch
"@monotykamary/localterm": patch
---

Default TERMINAL_BROWSER_FPS=120 in every spawned PTY (overridable like the other terminal-browser defaults). terminal-browser clamps its composition cadence to the window's reported frame rate, which reads as ~22Hz when its chromium runs offscreen — terminal output in localterm summed up stuck at 24-27fps regardless of transport speed. The localterm relay has been measured lossless past 100fps, so 120 lifts both 60Hz and 120Hz client displays.
