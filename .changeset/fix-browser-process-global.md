---
"@monotykamary/localterm-server": patch
---

Prevent the terminal browser bundle from evaluating the Node-only `process.platform` global, which left the app on a black screen before React could mount.
