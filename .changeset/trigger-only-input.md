---
"@monotykamary/localterm-server": patch
---

Require `trigger` on the automations create/update API and drop the legacy top-level `schedule` field. An automation's trigger is now always specified via `trigger` (`{kind:"schedule", schedule}` or `{kind:"watch", recursive}`); a schedule trigger's `schedule` still accepts a structured object or a bare cron string.
