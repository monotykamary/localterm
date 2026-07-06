---
"@monotykamary/localterm-server": patch
---

Restore the pre-command git-dirty and re-push the ambient summary on promote.

The hook-eval change that ran the automation's initial command inside the precmd hook (instead of typing it into the PTY) moved the command ahead of `__localterm_git_dirty` in the prompt chain, so for zsh/bash the first `git-dirty` only fired once the command finished — leaving the ambient git-diff overlay without an update signal while a git command was running (it didn't show or update until the command returned). The hook now emits a `git-dirty` before the `eval`, mirroring fish (which already prints it first in `fish_prompt`), so the overlay reflects the tree state as the command begins and the regular post-`eval` `git-dirty` still fires when it ends.

The overlay could also be stranded blank on a fresh attach: the coordinator pushes `git-diff-summary` straight to the wire (bypassing the pending buffer), but the `cwd` control frame is buffered and flushed on promote, and the client nulls its summary on `cwd` — so a summary that landed while the client was still pending could be wiped by the belated `cwd` reset, with nothing to re-push. `GitMetadataCoordinator` now exposes `replayLastSummary`, called at the end of `promote()` so the cached summary lands after the buffered `cwd` flush and the overlay is guaranteed populated on the now-live client. No-op when no summary is cached yet (the in-flight compute still broadcasts on completion).
