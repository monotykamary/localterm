---
"@monotykamary/localterm-server": patch
---

Drive foreground-process detection from shell hooks instead of polling
`pty.process`. zsh and fish emit OSC 7777 `fg;<token>` (preexec) and
`fg-idle` (precmd) via native hooks; bash (no preexec) gets precmd-idle plus the
initial-command-eval emit; the alt-screen stream signal stays as a fallback so
a closed tab never reaps a running TUI in an unhooked/precmd-only shell. This
removes the per-session 250ms `pty.process` poll, the `ps -o tpgid`
shell-alias learner, and the `ForegroundWatcher` — eliminating the subprocess
churn that kept syspolicyd warm on macOS. Adds `harness/fish-hook/`, a
container e2e that runs the real fish hook and asserts the OSC sequences land.
