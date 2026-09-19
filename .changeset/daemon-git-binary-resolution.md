---
"@monotykamary/localterm-server": patch
---

Restore git-backed surfaces (ambient diff summary, branch/PR metadata, worktrees, automation changed-file detection) in the daemon when `/usr/bin/git` is the Xcode shim. The daemon runs with a minimal baked PATH, so the old fallback to PATH-resolved `git` landed back on the same license-gated shim and every `runGit` call failed with exit 69 — the client never received a positive `git-diff-summary`, leaving the top-right diff indicator permanently hidden while git worked fine in the user's shell. `resolveGitBinary` now probes candidate binaries with `--version` and falls back through the Xcode developer dir's real git binary, then the homebrew prefixes, then PATH; `gitStatusSet` uses the same resolver instead of a bare `git` spawn.
