---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Add a per-project git worktree creation flow. Creating a worktree now happens
without a form and lands under `~/.localterm/worktrees/<project>/` on a memorable
adjective-noun branch (e.g. `clever-fox`). Two same-named repositories are put in
distinct project folders via a per-repo marker. The main worktree can never be
removed (server-enforced), the virtualized list no longer overlaps, and a
`⌘/Ctrl+Shift+B` shortcut plus "Create git worktree" command-palette entry open
the new worktree in a new tab.
