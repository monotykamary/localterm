---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Improve large-grid terminal throughput without skipping synchronized frames.

Loopback viewers now keep PTY output raw instead of serially constructing a decompressor for every server batch, while remote viewers retain Brotli or gzip compression. The terminal scans DEC 2026 boundaries with native byte search and drains paced output through an indexed queue, and the server refreshes its trailing output timer instead of allocating and cancelling one for every PTY chunk.
