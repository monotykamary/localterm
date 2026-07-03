---
"@monotykamary/localterm": minor
---

Add shell completions for the localterm CLI.

`localterm completions <bash|zsh|fish>` prints a completion script that wires tab-completion for subcommands, option flags, and dynamic values (live session ids, secret names, process names) back into a hidden `localterm _completion` command that owns the candidate logic, so completions stay in sync with the command tree automatically. `localterm completions <shell> --install`/`--uninstall` wire/unwire a single shell without the full install; `localterm install`/`uninstall` do the same for the detected shell (and all shells on uninstall). Wiring prefers each shell's auto-loaded completion drop-directory (fish always; zsh/bash when the completion system is set up) so no rc file is touched, and falls back to a guarded, lazy-loaded rc line otherwise — no startup cost, and a no-op when `localterm` isn't on PATH. The CLI source is refactored into a `createProgram()` factory so the completion resolver is testable against the real command tree.
