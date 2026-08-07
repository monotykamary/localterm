---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Support DEC private mode 1004 focus-event reporting end to end. The server already tracks terminal modes and per-tab focus state, so it now answers DECRQM probes for mode 1004 from that tracked state (xterm.js cannot) and injects `CSI I` / `CSI O` input into the PTY when the effective focus of attached viewers changes — only while the foreground app enabled reporting, mirroring the mouse-gating discipline. TUIs like pi's /live voice queue can now arbitrate a shared resource across tabs by following browser tab focus.
