#!/usr/bin/env bash
# Non-invasive e2e for the bash foreground hook (DEBUG-trap preexec) in
# packages/server/src/session.ts. session.ts injects a bash hook: a chained
# DEBUG trap emits OSC 7777 "fg;<token>" (first word of each command) and
# PROMPT_COMMAND emits OSC 7777 "fg-idle", so the daemon learns the foreground
# state from the shell without polling pty.process. This runs the EXACT hook
# source in a real interactive bash (over a pty, the way node-pty drives it),
# feeds a command, and asserts the OSC sequences land. It also chains a
# pre-existing user DEBUG trap to prove it isn't clobbered.
#
# Prereq: the docker image localterm-fish-e2e (a debian image with fish; bash
# comes from the base). The script builds it if missing:
#   docker build -t localterm-fish-e2e harness/fish-hook
#
# Usage: bash harness/fish-hook/run-bash.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSION="$REPO_ROOT/packages/server/src/session.ts"

# Drift guard: the hook lines this harness mirrors must still be in session.ts.
grep -qF '__localterm_fg_debug()' "$SESSION" || { echo "DRIFT: bash DEBUG-trap hook missing from session.ts" >&2; exit 1; }
grep -qF '7777;fg-idle' "$SESSION" || { echo "DRIFT: fg-idle emit missing from session.ts" >&2; exit 1; }
grep -qF '__localterm_prompt_start' "$SESSION" || { echo "DRIFT: prompt-start flag missing from session.ts" >&2; exit 1; }
grep -qF 'BASH_COMMAND%% *' "$SESSION" || { echo "DRIFT: BASH_COMMAND token extraction missing from session.ts" >&2; exit 1; }

if ! docker image inspect localterm-fish-e2e >/dev/null 2>&1; then
  echo "building localterm-fish-e2e image..." >&2
  docker build -t localterm-fish-e2e "$REPO_ROOT/harness/fish-hook" >&2 || { echo "docker build failed" >&2; exit 2; }
fi

WORK="$REPO_ROOT/test-results/bash-e2e"
rm -rf "$WORK"; mkdir -p "$WORK"

# A bashrc mirroring session.ts's bash hook (foreground-relevant parts), with a
# pre-existing USER DEBUG trap set before the install to prove chaining keeps
# it. Keep in sync with session.ts; the drift guard above fails if they diverge.
cat > "$WORK/bashrc" <<'BASHRC'
my_user_debug() { printf 'USERTRAP-MARKER\n'; }
trap my_user_debug DEBUG
__localterm_git_dirty() { printf '\e]7777;git-dirty\a'; }
__localterm_fg_precmd() { printf '\e]7777;fg-idle\a'; __localterm_in_prompt=0; }
__localterm_prompt_start() { __localterm_in_prompt=1; }
__localterm_in_prompt=0
__localterm_fg_debug() { [ "$__localterm_in_prompt" = 1 ] && return; case "$BASH_COMMAND" in __localterm_*) return ;; esac; printf '\e]7777;fg;%s\a' "${BASH_COMMAND%% *}"; }
__localterm_prev_debug_body=
__localterm_capture_debug() { local __t; __t=$(trap -p DEBUG); [ -z "$__t" ] && return; __t=${__t#trap -- }; __t=${__t% DEBUG}; __localterm_prev_debug_body=$__t; }
__localterm_capture_debug
if [ -n "$__localterm_prev_debug_body" ]; then trap '__localterm_fg_debug; eval "$__localterm_prev_debug_body"' DEBUG; else trap __localterm_fg_debug DEBUG; fi
PROMPT_COMMAND="__localterm_prompt_start;__localterm_git_dirty;__localterm_fg_precmd"
BASHRC

# Run interactive bash (--rcfile + -i) over a pty (script) and feed commands via
# a heredoc. script holds the pty open past bash's exit, so bound it with the
# container's timeout; the OSC bytes land long before the cutoff.
docker run --rm -i --init -v "$WORK:/work" -e TERM=xterm localterm-fish-e2e bash -c "timeout 12 script -qfc 'bash --rcfile /work/bashrc -i' /dev/null" > "$WORK/out.bin" 2>"$WORK/err.txt" <<'CMD' || true
echo hello
exit
CMD

# Assert via the cat -v visible form (ESC -> ^[, BEL -> ^G) so the patterns
# carry no control bytes.
fail=0
if cat -v "$WORK/out.bin" | grep -aqF '^[]7777;fg;echo^G'; then
  echo "PASS: preexec (DEBUG trap) emitted OSC 7777;fg;echo"
else
  echo "FAIL: no OSC 7777;fg;echo in bash output" >&2; fail=1
fi
if cat -v "$WORK/out.bin" | grep -aqF '^[]7777;fg-idle^G'; then
  echo "PASS: prompt emitted OSC 7777;fg-idle"
else
  echo "FAIL: no OSC 7777;fg-idle in bash output" >&2; fail=1
fi
if grep -aqF 'USERTRAP-MARKER' "$WORK/out.bin"; then
  echo "PASS: user's pre-existing DEBUG trap kept running (chained)"
else
  echo "FAIL: user DEBUG trap did not run (chaining broke)" >&2; fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "--- raw bash output (first 1.5KB) ---" >&2
  head -c 1500 "$WORK/out.bin" | cat -v >&2
  exit 1
fi
echo "bash foreground hook e2e: OK"
