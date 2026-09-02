---
"@monotykamary/localterm": patch
---

Prevent long-running synchronized TUIs from retaining stale rows until a page refresh when xterm's pending render frame loses the race with the next DEC 2026 update.
