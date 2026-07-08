---
"@monotykamary/localterm-server": patch
---

Fix the foreground watcher permanently misclassifying a `node`-based program (pi, `pnpm`, `npm`, `npx`, …) as the idle shell, so the tab favicon and session picker stayed grey ("ready") instead of blue ("alive-quiet") while the program ran quietly.

On macOS the watcher's shell-name learner (`confirmShellProcessName`) cached the foreground comm node-pty reported _before_ a separate `ps -o tpgid` read. A short-lived program that exited in the ~5-20ms window between those two reads left `tpgid == pid` (shell idle) while the caller still held the program's comm, so the learner cached that comm — e.g. `"node"` — as the shell's name for that shell path. Once poisoned, the cache (a module-level map keyed by shell path, never invalidated for the daemon's lifetime) made every later session filter that comm as the shell: `inferForegroundProcess` returned `null` for a genuinely-foreground `node` program, so `hasForeground` read false and `computeState` returned `"ready"`. The keep-awake trigger was unaffected (it walks the process tree and reads the command line, which sees `pi`/`node` directly), so the machine stayed awake while the favicon and picker showed grey — and `htop`/`python`/`bash` scripts were unaffected since their kernel comm isn't `"node"`.

The learner now re-reads the foreground comm via a getter _after_ `tpgid` confirms the shell is idle, so the cached name is the shell's actual comm — never the just-exited program's — closing the TOCTOU race. A daemon restart clears any already-poisoned cache.
