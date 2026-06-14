---
"@monotykamary/localterm-server": patch
---

Fix the diff viewer's PR detection showing the wrong PR, and make the PR indicator react to branch switches.

`gh pr list --head <branch>` matches the branch *name* across every fork, so on a common branch name like `main` it returned a stranger's same-named PR. PR detection now keeps only PRs whose head repository is your own (the `origin` remote's owner), so an unrelated fork's `main` PR no longer shows up and a branch with no PR of your own correctly shows none.

The ambient PR indicator now updates when you switch branches, using the same event channel as the working-changes indicator (the git watcher's push over the WebSocket — no polling): the diff summary now carries the current branch, and the client re-leases the branch's PR whenever the branch changes.
