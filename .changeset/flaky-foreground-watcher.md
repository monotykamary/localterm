---
"@monotykamary/localterm": patch
---

Stop the server `foreground`-channel integration test from flaking under full-suite load. Extracted the poll + dedup logic into a `ForegroundWatcher` driven deterministically under fake timers (matching the existing pattern in `folder-watch-manager.test.ts`), with `Session` delegating to it. Replaced the load-sensitive real-PTY assertion with deterministic unit coverage of dedup, null-seed suppression, stream-forced `set()`, self-dispose on exit, and dispose — stricter coverage, zero OS-process timing in the loop.
