---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Prevent Android's system keyboard and the terminal on-screen keyboard from appearing together.

Touch terminals now keep xterm's helper textarea read-only with `inputMode="none"`, explicitly dismiss any active native IME before opening the in-app keyboard, and retire the in-app keyboard before a control or input outside the terminal takes focus. Other app inputs continue to use the system keyboard normally.
