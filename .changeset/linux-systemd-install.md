---
"@monotykamary/localterm": minor
---

Bring `localterm install`/`uninstall` to Linux with a systemd **user unit** — the per-user mirror of the macOS LaunchAgent — so the daemon can be hosted on a VPS as an ssh + tmux replacement.

- `localterm install` now writes `~/.config/systemd/user/localterm.service` on Linux, runs `systemctl --user daemon-reload && enable --now`, and reuses the same Tailscale serve step as macOS to surface the daemon on the tailnet at `https://<node>.ts.net`. The unit is crash-only (`Restart=on-failure`: restarts on crash, but a clean `localterm stop` stays stopped), starts at login, and boots `After=network-online.target tailscaled.service` with an `ExecStartPre` that waits up to 30s for `tailscale status` (skipped entirely if tailscale isn't installed) so the daemon resolves the tailnet URL and trusts the `*.ts.net` host before the first request lands.
- `localterm restart`/`stop` detect the active user unit and route through `systemctl --user` (matching the existing launchd branches), falling back to the PID-based path when systemd isn't managing the daemon.
- On a headless VPS, `sudo loginctl enable-linger $USER` starts the service at boot without an active session. The daemon stays loopback-bound; ingress is the tailnet (Tailscale ACLs) or an `ssh -L 3417:localhost:3417` tunnel (ssh is the auth).
- Added a Linux e2e harness (`harness/linux-vps/`) that builds the whole workspace in a Debian container and verifies `localterm install` writes the unit (degrading gracefully with no systemd/tailscale/chromium — hints, not errors), the daemon serves `/api/health` on loopback, and `status`/`stop` work over the PID path.
