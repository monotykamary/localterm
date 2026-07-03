---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Serve shell completions from the daemon via `/api/completion` and lazy-load the
CLI's command graph so `<Tab>` no longer spawns Node when the daemon is up
(~210ms → ~10ms), falling back to `localterm _completion` when it's down
(~65ms). The endpoint is auth-gated like the rest of `/api/*`.
