---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Restore CDP workspace tab reconciliation on daemon start. Browser session restoration alone does not reliably reopen localterm tabs, which can leave startup without a usable terminal after a daemon restart.
