---
"@monotykamary/localterm": patch
---

Prevent Chromium's compositor keep-warm loop from delaying interactive WebSocket responses by one display interval. Localterm now pauses the no-op animation frame across bounded interactive WebGL responses while autonomous output, large output, and fallback rendering retain the existing keep-warm behavior.
