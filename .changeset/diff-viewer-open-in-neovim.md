---
"@monotykamary/localterm": minor
---

Open diff files in neovim from a new browser tab.

The diff viewer's selected-file header gains an `ExternalLink` icon (reusing the
worktrees "open in a new shell" glyph) next to the file name — and, when the
sidebar collapses to a narrow file-list popover, next to that picker. Clicking it
opens a fresh browser tab at the repo cwd with `nvim <path> && exit` injected as
the initial command, so you land in neovim on the exact file, and `:q` returns
to a shell that exits cleanly.

- `&& exit` rides the existing clean-exit path: a zero exit drives
  `window.close()` / the CDP-driven `closeTab` (the same mechanism worktree
  setup scripts and `closeOnFinish` automations use), so the tab auto-closes on
  `:q`. A non-zero exit (file unreadable, `:cq`, nvim missing) skips the
  auto-close and surfaces the dead-session mask with the code, so failures
  aren't silently dropped.
- The path is POSIX single-quote-escaped (embedded `'` via close-escape-reopen)
  so spaces, parens, `$`, backticks, and glob characters can't expand. Hidden
  for binary files, matching the existing `+`/`−` suppression.
