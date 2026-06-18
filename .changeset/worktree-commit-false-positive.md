---
"@monotykamary/localterm-server": patch
---

Stop emitting `git-commit` (and the other op-level git events) when a branch
ref is merely created or deleted rather than advanced. `git worktree add -b`,
`git branch`, and `git branch -d` flip the `heads/` namespace and previously
fell through to `git-commit`; now only `git-branch-change` fires for those.
Op-level classification (`git-commit` / `git-merge` / `git-rebase` /
`git-reset` / `git-cherry-pick`) is gated on an existing branch ref actually
changing SHA.
