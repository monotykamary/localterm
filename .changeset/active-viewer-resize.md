---
"@monotykamary/localterm-server": patch
---

Hand shared PTY sizing to the most recently focused or interactive viewer instead of permanently constraining every client to the narrowest viewport.

A phone and desktop still share one physical PTY size, but focus, pointer activity, or input now transfers resize ownership. Returning to the desktop expands the PTY and sends SIGWINCH while the mobile client remains attached, allowing full-screen apps such as Herdr and tmux to redraw at desktop width. A passive wider viewer keeps the existing inactive-viewport mask until it takes control.
