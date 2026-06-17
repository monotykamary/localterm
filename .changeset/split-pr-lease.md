---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix the ambient PR indicator never showing for a branch with a PR (and the
diff viewer opening without GitHub metadata). PR detection was raced against a
150 ms cap (GIT_BRANCH_INFO_PR_TIMEOUT_MS) in /api/git/branches, which is far
shorter than the GitHub REST API round-trip, so `pr` always resolved to null.

Split the lease: /api/git/branches now returns pure-local branch refs + default
base instantly (pr: null), and a new /api/git/branches/pr endpoint resolves the
PR separately (bounded by Octokit's own timeout; degrades to null on missing
token / network failure / no PR). The client leases both in parallel and merges
`pr` into the branch-info lease, so the toolbar paints right away and the PR
indicator / branch-mode metadata land when gh responds — no blocking, no
false-null regression.

Also fix a latent schema violation the split exposed: with `pr` now populated,
the diff viewer opens in branch mode, whose per-file additions/deletions are
reconciled toward git's `diff.stats()` aggregate. jsdiff's per-file patch counts
overshoot the aggregate on large diffs (trailing-newline / line-ending drift),
and the redistribution subtracted 1 unconditionally, driving zero-count files
to -1 — which `gitDiffFileMetaSchema` (`.nonnegative()`) rejects, failing the
whole file-list parse and showing "Couldn't load the diff". Extracted to
`reconcileFileStats`, which only decrements files that have room, so per-file
counts never go negative.
