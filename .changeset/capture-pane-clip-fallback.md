---
"@monotykamary/localterm-server": patch
---

`capture-pane --png` no longer returns `no_browser` when the viewer tab's `.xterm` hasn't laid out yet: a 0-size clip falls back to a full-viewport screenshot, and an empty first capture (the tab hadn't committed a frame — the render landed just past the poll window) is retried once after a settle.
