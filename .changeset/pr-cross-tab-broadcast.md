---
"@monotykamary/localterm-server": patch
---

Propagate a refreshed PR lease to every PTY sharing the same directory.

The ambient PR indicator was a per-tab pull lease: each PTY fetched its own PR
from `/api/git/branches/pr` and held it in local state, so a remote state change
one tab observed never reached its siblings. Two PTYs in the same cwd could
diverge — one "merged" (after a manual refresh) and one still "open" — because a
merge on GitHub produces no local git-dirty signal for the other tab to refetch
from. The git-dirty front already shared this (the per-cwd coordinator
broadcasts the diff summary to every subscribed tab); only the PR front didn't.

The per-cwd coordinator now also broadcasts a `git-branch-pr` message to every
subscribed tab when the endpoint recomputes the PR, so a refresh on one tab
converges its siblings. The PR is deliberately not replayed on subscribe: with
no local signal refreshing it, a cached value can be arbitrarily stale, and
replaying it would race a tab's own freshly-fetched lease — each tab still
populates its initial PR from its own HTTP fetch and converges via the pushes.
