---
"@monotykamary/localterm-server": minor
---

Add a per-automation "clear run history" action.

A single automation's run history can now be cleared without wiping the whole Triage inbox. `POST /automations/:id/clear-history` empties that automation's `runs` array while keeping the automation, its run-count, and lifecycle (use `POST /automations/:id/reset` to also restart a finished automation). The Automations modal's per-automation History section gains an eraser button (two-click confirm) that calls it, leaving every other automation's runs intact — the existing `POST /triage/clear-history` all-clear is unchanged.
