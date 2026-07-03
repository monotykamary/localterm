---
"@monotykamary/localterm-server": patch
---

Re-sync the foreground state on WS attach so the favicon stops going stale after a daemon restart or a page refresh. The foreground watcher only emits on change, so a reattaching client never learned the current state: after a restart the icon stayed blue (a stale "process running" reading the watcher never re-emitted as null), and after a refresh it reverted to grey even with a foreground process active (green on stdout, then grey on silence because `hasForegroundProcess` was never re-seeded). The `{type:"session"}` frame now carries the current foreground-process snapshot alongside cwd/title, and the client re-seeds the favicon from it on every attach — blue for a running-but-quiet process, grey for an idle shell.
