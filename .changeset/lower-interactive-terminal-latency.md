---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Lower input-to-display latency for synchronized terminal applications without changing Localterm's streaming throughput path.

The server now recognizes DEC 2026 synchronized-output completion across PTY chunk boundaries and flushes that complete redraw immediately, while unsynchronized applications retain the existing anti-flicker idle window. For small output that immediately follows terminal input, the WebGL client consumes xterm's already-pending render once instead of waiting for its animation frame; autonomous output, large frames, hidden tabs, DOM fallback, compression, backpressure, and alpha-mask rendering remain on their existing paths.
