---
"@monotykamary/localterm-server": patch
---

Revert the terminal-browser frame relay from 2.71.0: it forced the kitty file frame transport and gated delivery on a negotiated compress mode, but loopback sessions negotiate raw mode, so terminal-browser frames were never delivered and the screen rendered blank. 2.70.7 behavior restored while the transport negotiation is redesigned.
