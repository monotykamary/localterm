---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix macOS daemon crash loops from per-file watcher descriptor exhaustion. Restore native recursive watching on macOS and Windows, use native nonrecursive subscriptions, and keep Linux recursive watcher errors inside the recovery boundary.
