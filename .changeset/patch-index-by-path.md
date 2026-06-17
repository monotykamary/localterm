---
"@monotykamary/localterm": patch
"@monotykamary/localterm-server": patch
---

Fix dropped patches when a path spans multiple `diff --git` blocks or contains a space.

The 2.1.0 subprocess backend paired `--numstat` entries with `--patch` chunks
positionally. That broke in two ways, both leaving the per-file patch as
`patchOmitted`:

- A single numstat entry can span several `diff --git` blocks — a symlink
  deleted (mode 120000) and re-added as a regular file is emitted by git as a
  deletion + an addition sharing one path, so `--patch` has one more block than
  `--numstat` has entries. The positional lengths didn't match, so the safety
  check marked every file's patch as omitted.
- Paths with a space get a trailing tab appended by git on the `---`/`+++` lines
  (a disambiguator), which numstat doesn't carry, so path keys didn't line up.

Patches are now indexed by path (extracted from each chunk's `+++ b/...` /
`--- a/...` / `rename to ...` header, with C-style unquoting and the trailing
tab stripped) and concatenated when several blocks share one path. numstat
remains the source of truth for the file list and counts. Verified against
models.dev (5848 files): all files return their patch, and a symlink→regular
transition correctly yields a single entry with a 2-block delete+add patch.
