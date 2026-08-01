---
"@monotykamary/localterm-server": minor
"@monotykamary/localterm": minor
---

Generic kitty file-medium relay for pixel-perfect In-Loop Term speed. The daemon now understands kitty graphics APCs that use the file medium (t=f): it answers a=q probes itself (validated against the temp root, honoring q quiet semantics), and relays named frame transmits as raw RGBA over a dedicated 0x04 binary WS message to a full-screen canvas overlay. Any app probing the file medium gets the fast path — terminal-browser picks it without the env override, restoring the 60fps-class rendering the inline fallback couldn't reach on xterm.js. Raw/loopback sessions now negotiate always-on binary framing ({ready}.binaryFraming + a {binary-framing} confirmation) so frame bytes can't be mistaken for terminal output; legacy servers/clients degrade to the existing inline path unchanged.
