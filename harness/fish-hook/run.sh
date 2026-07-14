#!/usr/bin/env bash
# Non-invasive e2e for the fish foreground hook in packages/server/src/session.ts.
#
# localterm's session.ts injects a fish hook: fish_preexec emits OSC 7777
# "fg;<token>" (the first word of the command line) and fish_prompt emits OSC
# 7777 "fg-idle", so the daemon learns the foreground state from the shell
# instead of polling pty.process. This runs the EXACT hook source in a real
# interactive fish (over a pty, the way node-pty drives it) and asserts the OSC
# sequences land in the raw PTY output. It drift-guards first: it checks
# session.ts still contains the hook lines the harness mirrors, so a hook edit
# that forgets this test fails loudly.
#
# Prereq: the docker image localterm-fish-e2e (build it if missing — the script
# builds it automatically):
#   docker build -t localterm-fish-e2e harness/fish-hook
# (If the base-image pull fails with a credential-helper error, that is a
# docker-credsStore config issue on the host, not this test.)
#
# Usage: bash harness/fish-hook/run.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSION="$REPO_ROOT/packages/server/src/session.ts"

# Drift guard: the hook lines this harness mirrors must still be in session.ts.
grep -qF 'function __localterm_fg_preexec --on-event fish_preexec' "$SESSION"   || { echo "DRIFT: fish preexec hook missing from session.ts" >&2; exit 1; }
grep -qF '7777;fg-idle' "$SESSION"   || { echo "DRIFT: fg-idle emit missing from session.ts" >&2; exit 1; }
grep -qF 'string split' "$SESSION"   || { echo "DRIFT: fish token extraction missing from session.ts" >&2; exit 1; }

# Build the fish image if it is missing (turnkey).
if ! docker image inspect localterm-fish-e2e >/dev/null 2>&1; then
  echo "building localterm-fish-e2e image..." >&2
  docker build -t localterm-fish-e2e "$REPO_ROOT/harness/fish-hook" >&2     || { echo "docker build failed" >&2; exit 2; }
fi

WORK="$REPO_ROOT/test-results/fish-e2e"
rm -rf "$WORK"; mkdir -p "$WORK"

# The hook source, mirroring prepareOsc7Hook's fish branch for the interactive
# (no initial-command) path. Keep in sync with session.ts; the drift guard above
# fails this run if they diverge.
cat > "$WORK/hook.fish" <<'HOOK'
function __localterm_osc7 --on-variable PWD
    printf '\e]7;file://%s%s\a' (hostname 2>/dev/null || echo localhost) $PWD
end
__localterm_osc7
function __localterm_fg_preexec --on-event fish_preexec
    printf '\e]7777;fg;%s\a' (string split ' ' -- $argv[1])[1]
end
function __localterm_prompt_hook --on-event fish_prompt
    printf '\e]7777;git-dirty\a'
    printf '\e]7777;fg-idle\a'
end
HOOK

# Run interactive fish over a pty (script), sourcing the hook, and feed a
# command. script holds the pty open past fish's exit, so bound it with the
# container's timeout; the OSC bytes land in the output long before the cutoff.
printf 'echo hello\nexit\nexit\n' \
  | docker run --rm -i --init -v "$WORK:/work" -e TERM=xterm localterm-fish-e2e \
    bash -c "timeout 12 script -qfc \"fish -C 'source /work/hook.fish'\" /dev/null" \
  > "$WORK/out.bin" 2>"$WORK/err.txt" || true

fail=0
if grep -aqF $'\x1b]7777;fg;echo\x07' "$WORK/out.bin"; then
  echo "PASS: preexec emitted OSC 7777;fg;echo (first word of "echo hello")"
else
  echo "FAIL: no OSC 7777;fg;echo in fish output" >&2
  fail=1
fi
if grep -aqF $'\x1b]7777;fg-idle\x07' "$WORK/out.bin"; then
  echo "PASS: prompt emitted OSC 7777;fg-idle"
else
  echo "FAIL: no OSC 7777;fg-idle in fish output" >&2
  fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "--- raw fish output (first 1.5KB) ---" >&2
  head -c 1500 "$WORK/out.bin" | cat -v >&2
  exit 1
fi
echo "fish foreground hook e2e: OK"
