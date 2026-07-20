---
"@monotykamary/localterm-server": patch
---

Stop detached PTY sessions from creating recursive Git watchers until a viewer attaches, and release the watcher when the final viewer detaches.
