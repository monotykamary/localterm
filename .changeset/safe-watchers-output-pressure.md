---
"@monotykamary/localterm-server": patch
---

Contain filesystem watcher failures with owned cross-platform subscriptions, bounded recovery, and disposal-safe cleanup. Exclude node_modules from Git watches to reduce Linux inotify pressure. Account for image-file output before asynchronous processing, pause expansion when downstream buffers back up, and discard disposed-session work without unhandled rejections. Preserve running detached shells when the session cap is reached instead of evicting active commands.
