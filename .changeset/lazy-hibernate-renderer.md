---
"@monotykamary/localterm-server": patch
---

Hydrate the hibernation renderer on demand during graceful shutdown from the bounded raw replay ring instead of live-parsing every PTY chunk into an always-on per-session xterm. This removes the largest steady-state per-session memory cost in the daemon (a parsed 2000-line terminal grid plus constant parse churn per PTY chunk); the persisted shutdown snapshot is unchanged. Also bound the kitty frame-path realpath cache with insertion-order LRU eviction so an app minting unique frame paths cannot grow the map for the daemon's lifetime.
