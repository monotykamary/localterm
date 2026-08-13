---
"@monotykamary/localterm": patch
---

Keep the existing terminal frame visible while a replacement PTY reconnect buffers its scrollback, then apply reset and replay as one xterm parse transaction to eliminate the blank restart flash.
