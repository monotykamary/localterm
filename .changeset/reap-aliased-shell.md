---
"@monotykamary/localterm-server": patch
---

Fix orphaned idle PTYs that never reap when the shell aliases its process name.

On macOS `/bin/sh` is bash (GNU bash 3.2 in sh-mode), which overrides its kernel process name at startup so node-pty's `pty.process` reports `"bash"` for an idle `/bin/sh` while the invoked basename is `"sh"`. The no-clients grace reap compared `pty.process` only against the invoked basename, so an idle `/bin/sh` was misreported as a running foreground program — `computeState` read `"alive-quiet"` forever and the grace timer rescheduled indefinitely. A closed `/bin/sh` tab (or any shell whose reported name differs from the invoked basename) sat dormant and was never reaped: the exact "orphaned PTYs that have nothing in them don't clear" symptom.

The foreground check now disambiguates with the terminal's foreground process group instead of the process name: the shell is its own process-group leader holding the terminal at idle (`tcgetpgrp == pty.pid`), while a foreground program runs in its own group (`tcgetpgrp != pty.pid`). When `tpgid` confirms the shell is idle, the current `pty.process` reading is recognized as the shell's alias name and learned (cached per shell path, so the one `ps -o tpgid=` runs at most once per aliased path per process lifetime). This is name-agnostic — no proctitle-timing race, no polling a short-lived session could poison — and a genuine foreground program (a child, different pid/group) is still reported as foreground, so the "keep a dormant PTY alive while a foreground program runs quietly" guarantee is preserved. Non-aliased shells (zsh/bash) never mismatch and never run the check; Linux reads `/proc/<pgrp>/cmdline` (the invoked name, already matched), so the fix is macOS-scoped.
