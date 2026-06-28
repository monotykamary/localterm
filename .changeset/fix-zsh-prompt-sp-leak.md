---
"@monotykamary/localterm-server": patch
---

Stop zsh's `PROMPT_SP` from leaking the EOL mark (`%`) and fill-to-end-of-line spaces (blank lines) above the prompt on mobile.

zsh's `PROMPT_SP` (on by default) prints, before each prompt when the prior line had no trailing newline, the `PROMPT_EOL_MARK` (`%B%S%%%s%b` — a bold + reverse-video `%`, the "white-background %") **and** a fill-to-end-of-line space burst, then zle's redraw erases both. localterm's precmd/chpwd hooks emit OSC sequences (git-dirty, osc7) with no trailing newline, so `PROMPT_SP` fires on every prompt.

localterm resizes xterm **before** the server's PTY catches up — the client shrinks xterm to the new viewport immediately, then sends the resize, which round-trips over a DERP-relayed tailnet at 200–400ms plus a debounce. During that window xterm is narrower than the PTY. At spawn the gap is widest: the PTY starts at the wide `DEFAULT_COLS` (120) while the mobile xterm is still its narrow phone viewport (often ~40 cols). If the shell redraws in the gap — a SIGWINCH from a prior resize landing, a prompt cycle, or the first prompt at startup — the mark and the fill spaces (sized for the wider PTY) wrap in the narrower xterm, so zle's `clear-to-end-of-screen` erases from the wrapped line down and leaves the mark as a stray `%` and the fill spaces as a blank line above the new prompt:

```
$ %
$
```

…or, once the visible mark is gone, just the blank line:

```

$
$
```

This is why it only appeared on the phone (the virtual keyboard triggers frequent viewport shrinks; spawn starts the PTY wide while xterm is narrow), only on new PTYs / intermittently (only when a shell redraw coincides with the mismatch), and was reduced-but-not-eliminated by predictive-typing-off (its cursor manipulation widened the desync window, but the core width-mismatch leak remained). On the macbook the width never rapidly diverges, so the erase always landed and neither artifact was ever visible. An earlier attempt emptied `PROMPT_EOL_MARK`, which removed the visible `%` but left the fill-to-EOL spaces — which wrap the same way and produce the blank line. The fill spaces are not independently configurable, so the complete fix disables `PROMPT_SP` entirely: neither the mark nor the spaces are emitted, so nothing can wrap and leak.

The cost is the standard non-zsh behavior (what bash/sh already do): a command whose output genuinely lacks a trailing newline gets the next prompt on the same line instead of a fresh one. That's acceptable here — the only unterminated output in this setup is localterm's own OSC hooks, which are invisible (consumed by xterm as escape sequences, no visible chars, no cursor move), so the prompt still starts cleanly after newline-terminated output (the common case). Set after the user's `.zshrc` is sourced so it overrides any user setting. The bash hook is unaffected (bash has no `PROMPT_SP` equivalent). No effect on the macbook: the artifacts were erased correctly there anyway, so nothing changes there.
