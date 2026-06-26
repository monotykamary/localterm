---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add true PTY multiplexing: a shell now outlives the tab that spawned it, and any tab can switch to it from the session switcher.

Closing a tab detaches instead of killing — the shell waits (dormant) for a 30s grace window, then is reaped if no tab reattaches. One authority spawns a shell; others join alongside via the switcher. This replaces the prior 30s `SessionReattachPool` grace (same-tab-only) with a daemon-wide `SessionManager` that owns every live PTY, supports any number of attached clients per PTY (output/title/cwd/foreground/exit fan out to all of them), tmux-style min(cols)/min(rows) resize across clients, OS-pipe backpressure that pauses the PTY when any client falls behind, and a continuous per-session scrollback ring buffer replayed on attach so a switching tab lands on recent output instead of a blank screen.

New surface: `GET /api/sessions` (list live PTYs), `DELETE /api/sessions/:id` (kill). The WS gains a `{type:"ready", replay}` handshake — the localterm client sends it after the session frame so the scrollback replay lands before live fan-out on a switch; a back-compat client that never sends it (and never sends input) is auto-promoted after a 100ms window with its buffered output flushed, so no output is ever lost and older clients keep working. `?sid=` now attaches to any live PTY by id, not just the same-tab parked one.

The terminal app adds a sessions modal in the top-right toolbar (SquareTerminal icon, `⌘`/`Ctrl+I`), styled as a command-palette overlay with search, virtualized rows, keyboard navigation, and active/orphaned status pills. The command palette gains a "Sessions" entry. `SessionRegistry` + `SessionReattachPool` are replaced by `SessionManager` (+ extracted `GitDirtyCoordinator` and `utils/ws-socket`).
