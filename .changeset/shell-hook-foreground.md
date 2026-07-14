---
"@monotykamary/localterm-server": patch
---

Drive foreground-process detection from shell hooks instead of polling
`pty.process`. zsh and fish emit OSC 7777 `fg;<token>` (preexec) and `fg-idle`
(precmd) via native hooks; bash uses a chained DEBUG-trap preexec (preserves
any user DEBUG trap) plus a precmd `fg-idle`; the initial-command-eval hook
also emits `fg;<token>` so worktree/automation tabs detect their program. The
alt-screen stream signal stays as a fallback for unhooked shells (sh/dash), so a
closed tab never reaps a running TUI. This removes the per-session 250ms
`pty.process` poll, the `ps -o tpgid` shell-alias learner, and the
`ForegroundWatcher` — eliminating the subprocess churn that kept syspolicyd
warm on macOS. Keep-awake's automatic mode now short-circuits the `ps`
process-tree walk when a session's hook-reported foreground name is itself a
trigger (the common case: the user runs vim/ffmpeg/etc. directly), falling
back to the walk only for child-process triggers (make -> ffmpeg) and
unhooked shells. Adds `harness/fish-hook/` (run.sh + run-bash.sh): container
e2e that run the real fish and bash hooks and assert the OSC sequences land.
