---
"@monotykamary/localterm": minor
"@monotykamary/localterm-server": minor
---

Replace the es-git (wasm libgit2) diff backend with canonical git subprocesses.

The diff viewer and its prefetch queue now read `git diff --numstat --name-status
--patch` and `git ls-files --others` instead of es-git's in-process libgit2.
This eliminates the whole drift class that kept biting us:

- libgit2's `DiffFile.isBinary()` returned false until `diff.stats()` was
  materialized (binary files read as text and got junk patches synthesized from
  utf8-decoded blob bytes — the latent regression fixed ad-hoc in 2.0.5).
- jsdiff line counts diverged from git's own `--numstat`, so the badge totals and
  the diffs the user opened didn't always agree with what `git diff` shows in
  their terminal.
- rename/copy detection and honoring of `core.*` config subtly differed from
  canonical git.

What the user sees in their terminal is now exactly what we compute — the diff
data is pulled from git itself, so the counts, binary detection, rename paths
and patch bodies all match `git diff` by construction.

Runtime requirement: git must now be on PATH for diff features (localterm's
audience is dev terminals, where git is universal). With git absent, diff
lookups degrade to `isRepo: false` rather than crashing.

The per-`(cwd, mode, base)` cache layer from 2.0.5 is retained, so the viewer's
per-file patch prefetch burst stays an O(1) map lookup with no subprocess when
the cache is warm. Cold fill is 4 parallel `git` invocations (numstat,
name-status, patch, untracked ls-files) instead of the previous one-tree-diff +
per-file jsdiff, and per-keystroke summary reuses the cheap numstat-only path.

Drops the `es-git` dependency (and its native per-platform binaries — no longer
in `onlyBuiltDependencies`) and the `diff` (jsdiff) dependency entirely.
