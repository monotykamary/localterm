---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix mobile multi-viewer and new-shell interactions.

- Coordinate xterm-generated terminal query replies so only the active viewer
  answers the PTY, preventing duplicate OSC and DSR responses when a phone is
  attached while preserving input from every viewer.
- Treat New shell as an explicit fresh spawn. Phones and tablets now reuse the
  current terminal surface instead of opening a PWA window with browser chrome;
  desktop continues opening a separate tab.
