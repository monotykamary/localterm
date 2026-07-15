---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Forward held Ctrl+Tab chords to foreground terminal applications.

Ctrl+Tab and Ctrl+Shift+Tab now become legacy Tab and BackTab input while a foreground application owns the PTY, allowing prefix-driven multiplexers such as Herdr to cycle panes without the browser consuming the chord. Idle shells still defer modified Tab to the browser, and Cmd+Tab remains reserved for the operating system.
