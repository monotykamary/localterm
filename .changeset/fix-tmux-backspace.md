---
"@monotykamary/localterm-server": patch
---

Send DEL for legacy Backspace on macOS so tmux panes and raw CLI menus honor the PTY erase character instead of receiving a literal Ctrl-H.
