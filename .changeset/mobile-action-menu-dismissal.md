---
"@monotykamary/localterm": patch
---

Collapse the mobile action menu whenever a sub-surface opens (sessions,
worktrees, ports, automations, QR, command palette, find, diff viewer) so the
expanded toolbar no longer lingers over the terminal after a session switch or
modal launch. The menu now dismisses on a tap outside itself instead of a
dedicated overlay layer, and the diff/PR indicators open the diff viewer
directly rather than doubling as the toolbar toggle. Adds light tap haptics on
the toolbar toggle and session switch.
