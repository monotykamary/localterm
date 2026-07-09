---
"@monotykamary/localterm-server": patch
"@monotykamary/localterm": patch
---

Run the diff viewer's open-in-neovim initial command via the shell's prompt hook, same as automations and worktree setup scripts.

`nvim <path> && exit` was still forced through the at-spawn PTY write because fullscreen TUIs were excluded from the hook-eval path. That special case is removed: any initial command on a hooked shell (zsh/bash/fish) now runs through `LOCALTERM_INITIAL_COMMAND` + prompt-hook `eval`, so open-in-neovim no longer races the line editor's ECHO. Unhooked shells keep the at-spawn PTY write (no hook to eval with).
