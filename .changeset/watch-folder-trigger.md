---
"@monotykamary/localterm-server": minor
---

Add a "watch a folder" trigger for automations as an alternative to a schedule. A watch automation runs its command when its working directory changes, detected via native filesystem events (no polling). A burst of changes is debounced into a single run, and a new run won't start while a previous one is still in flight (so a command that writes into the watched folder won't loop); watch runs count toward the same run limit as scheduled runs.

Automations now carry a `trigger` union (`{kind:"schedule", schedule}` or `{kind:"watch", recursive}`) in place of a bare `schedule` field. The `~/.localterm/automations.json` file migrates v2→v3 automatically, and the create/update API still accepts the legacy top-level `schedule` (object or cron string) for back-compat.
