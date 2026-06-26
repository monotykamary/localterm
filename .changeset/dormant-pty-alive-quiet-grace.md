---
"@monotykamary/localterm-server": patch
---

Keep a dormant PTY alive while a foreground program runs quietly, not only while output is streaming. The no-clients grace reap re-checked only output recency — a shell whose tab favicon would still be green — so a quiet-but-running shell (the favicon's blue `alive-quiet` state: a `sleep`, a paused build, an editor waiting on input) was reaped once output went quiet, even with no viewers. The re-check now reuses the same favicon-equivalent activity state already surfaced on the session list and spares any shell that's `running` or `alive-quiet`, reaping only a truly idle one (`ready`). The `SessionActivityState` comment's stated intent — "gates the grace reap so a quiet-but-running shell isn't reaped" — now actually holds.
