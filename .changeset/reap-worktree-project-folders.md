---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Reap empty project folders left in `~/.localterm/worktrees/` after a stale worktree is swept. `git worktree remove` deletes the worktree but leaves its `~/.localterm/worktrees/<project>/` folder holding only the `.localterm-repo-id` marker; the sweep now removes that folder once it's empty (never when a sibling worktree or any other file remains), so the shared dir no longer accumulates dead project folders.
