---
"@monotykamary/localterm": patch
---

Restore sync-parse reach on the OutputBatcher → terminal.write path: set
`_core._writeBuffer._didUserInput = true` before each write so xterm routes
through its synchronous `_innerWrite` branch instead of deferring parse via
`setTimeout(0)`. trace8 (post-revert, no sync-parse) showed 29.4% main-thread
busy with 442 xterm-installed `refreshRows` rAFs/sec and 452 of 462 vsyncs
firing 2-3 rAFs; trace7 (f0f26db, with sync-parse alongside a 16KB per-rAF
write cap and a `setTimeout(0)` keep-warm re-arm) showed 9.8% busy with only
30 `refreshRows` rAFs/sec and 138/462 vsyncs double-firing — the sync-parse
direction was load-positive.

This isolates just that piece: no 16KB write cap (the cap throttled drainage
below pi's ~450-frame/sec emission rate, producing visible backpressure and
queued pi redraws — the "scroll from there down" symptom), no `setTimeout(0)`
keep-warm re-arm (that doubled rAF schedules per vsync and created wasted
paint work at 120 paints/sec vs 60 commits/sec). Keeps `bc9e0e5`'s
`isDispatching` re-entry guard unchanged. Test fake terminals don't expose
`_core._writeBuffer`, so the reach degrades silently to `terminal.write(bytes)`
with no fixture changes.
