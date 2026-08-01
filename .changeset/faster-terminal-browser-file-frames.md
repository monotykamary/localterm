---
"@monotykamary/localterm-server": minor
---

Fast-path rendering for terminal-browser. Force its kitty `file` frame transport so each frame is a tiny "transmit by name" escape instead of base64 RGBA inline, then have the daemon relay it: it detects the `a=T…t=f` sequence in the PTY output, reads the named RGBA temp frame, and pushes a dedicated `0x04` binary WebSocket frame that the tab blits onto a full-screen canvas overlay. This lifts terminal-browser off the base64-inline bandwidth cap on the xterm.js side (the path to ~60fps), with the query/`file`-probe gracefully degrading to nothing for browsers without a decompressor.
