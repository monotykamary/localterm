---
"@monotykamary/localterm": patch
---

Stop the worktree setup script from re-running every time a worktree tab is opened. The `?cmd=` setup-script token is now cleared from the address bar once the session that ran it is established, mirroring the single-use `?run=` automation token — so reloads, reconnects, and copied/restore links open a plain shell at the worktree cwd instead of re-running installs and env copy.
