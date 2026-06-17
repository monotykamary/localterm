---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Cache the full diff pass per (cwd, mode, base) so the viewer's per-file patch
prefetch queue is O(1) map lookups instead of O(files²).

The diff viewer opens into branch mode and its prefetch queue then requests
~every changed file's patch. Each `getGitDiffFilePatch` call previously
re-ran the whole-tree diff + a jsdiff for every file, so a large branch
comparison (e.g. several thousand commits / ~20k files) blocked the daemon's
event loop for the cumulative duration and made localterm unresponsive.

Now the single full diff pass (one tree diff, one jsdiff per file — used for
both counts and patch, where the old code ran jsdiff twice) is built once per
`(cwd, mode, base)` and cached. The cache is invalidated on the git-dirty WS
signal (before the summary push) with a TTL backstop. Hot per-file lookups
drop from ~1.3s to ~0.15ms.

Also drops `reconcileFileStats`: per-file jsdiff counts are non-negative by
construction, so the negative-additions class of bug no longer exists (the
wire schema's `.nonnegative()` can't be tripped). Removed `compute-patch`'s
only count-drift consumer; the util stays (still builds the patches).
