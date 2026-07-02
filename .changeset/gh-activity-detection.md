---
"@monotykamary/localterm-server": minor
---

Detect `gh` (GitHub CLI) invocations event-driven, without polling, and use the signal to auto-refresh the current branch's PR lease.

The keep-awake process-tree walker is the wrong tool for short-lived CLIs like `gh` — they exit before a `ps` snapshot can observe them. So `gh` is now a built-in **activity-watched** program: the daemon generates a `gh` PATH shim (in `~/.localterm/shims`, alongside the secret shims) that runs the real binary as a child, then overwrites `~/.localterm/activity/gh` with the shell's `$PWD` after it exits. A new `ProcessActivityWatcher` keeps one `fs.watch` on that dir (no timer) and emits a per-cwd-debounced `activity` event on each write.

- The signal fires **after** `gh` completes (the shim captures the exit code, signals best-effort, then `exit $_rc`), so consumers read post-command state — e.g. `gh pr merge` has already changed the PR before the refresh runs. Secret-only programs keep `exec` (unchanged); only activity-watched programs run as a child.
- The activity shim is generated even with no secrets configured (no secret needed for `gh` — it has its own auth), so detection is on by default. If `gh` is also a secret process, the shim merges: resolve the secret(s), then run + signal.
- The one wired consumer: on a `gh` activity event, the daemon refreshes the PR lease for that cwd (`getGitBranchPr` + `broadcastGitBranchPr`) — but only when a coordinator exists for it (a tab is viewing the repo), so a `gh` run in an unviewed directory never triggers a pointless GitHub API call. This is the role the working-tree `git-dirty` signal plays for the diff summary, but for remote GitHub state the working tree never reflects.
- `SessionManager.hasCoordinatorFor(cwd)` exposes the subscriber check (mirrors `broadcastGitBranchPr`'s non-creating philosophy).
- Built-in activity-watched set is `ACTIVITY_WATCHED_PROGRAMS` in `constants.ts` (currently `["gh"]`); add programs there to extend. The signal is darwin-only for now, gated on the secret backend (the shim feature is darwin-only); elsewhere no shim is generated and the watcher has nothing to watch.
