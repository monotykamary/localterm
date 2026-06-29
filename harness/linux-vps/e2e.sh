#!/usr/bin/env bash
# End-to-end smoke test for the Linux VPS install path, run inside the
# harness/linux-vps Docker image. systemd / tailscale / chromium are intentionally
# absent, so this proves the graceful-degradation path: install still writes
# the unit, and the daemon serves + status/stop work over the PID-based path.
set -euo pipefail

PORT=3417
HOST=127.0.0.1
CLI="node /repo/packages/cli/bin/localterm.mjs"
export HOME=/root

step() { printf '\n==> %s\n' "$*"; }

assert_contains() {
  local file=$1 pattern=$2
  grep -q -- "$pattern" "$file" || { echo "FAIL: '$pattern' not found in $file"; exit 1; }
}

step "install (writes the systemd user unit; no systemd/tailscale/chromium → hints, not errors)"
$CLI install --port "$PORT" --host "$HOST"

UNIT="$HOME/.config/systemd/user/localterm.service"
test -f "$UNIT" || { echo "FAIL: unit file not written at $UNIT"; exit 1; }
assert_contains "$UNIT" "ExecStart="
assert_contains "$UNIT" "--foreground"
assert_contains "$UNIT" "Restart=on-failure"
assert_contains "$UNIT" "WantedBy=default.target"
assert_contains "$UNIT" "command -v tailscale"
echo "    unit file OK at $UNIT"

step "start daemon (foreground, loopback) — no systemd in this container"
$CLI start --foreground --port "$PORT" --host "$HOST" > /tmp/localterm.log 2>&1 &
DAEMON_PID=$!

step "wait for /api/health"
for i in $(seq 1 60); do
  if curl -fsS "http://$HOST:$PORT/api/health" >/dev/null 2>&1; then
    echo "    healthy after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "FAIL: daemon not healthy within 60s"
    echo "----- daemon log -----"
    cat /tmp/localterm.log || true
    kill "$DAEMON_PID" 2>/dev/null || true
    exit 1
  fi
done

step "status"
$CLI status | tee /tmp/localterm-status.log
grep -q "running" /tmp/localterm-status.log || { echo "FAIL: status did not report running"; exit 1; }

step "stop (PID path — systemd not active here)"
$CLI stop
wait "$DAEMON_PID" 2>/dev/null || true

step "e2e OK"
