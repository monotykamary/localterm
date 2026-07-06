# Auto-start & remote access

`localterm install` sets up an auto-start service and provisions the optional
URL surfaces. Remove it all with `localterm uninstall`.

## macOS (launchd)

`localterm install` creates a [launchd](https://support.apple.com/guide/terminal/launchd-apda4e235115/2.14/mac/14.1)
plist in `~/Library/LaunchAgents/` with `RunAtLoad` and `KeepAlive` enabled:

- **RunAtLoad** — localterm starts automatically when you log in.
- **KeepAlive** — launchd restarts the daemon immediately if it crashes.

```bash
npx @monotykamary/localterm@latest install
# or with a global install:
localterm install
```

## Linux (systemd user unit)

`localterm install` writes a [systemd](https://systemd.io/) **user unit** at
`~/.config/systemd/user/localterm.service` (the per-user mirror of the macOS
LaunchAgent — no root required, state stays in `~/.localterm/`), runs
`systemctl --user daemon-reload` and `enable --now`, and runs the same Tailscale
step as on macOS:

- **`Restart=on-failure`** — the daemon restarts immediately if it crashes, but
  a clean `localterm stop` stays stopped (crash-only, matching the macOS
  `KeepAlive`).
- **`After=network-online.target tailscaled.service`** + an `ExecStartPre` that
  waits up to 30s for `tailscale status` to answer (only when tailscale is
  installed), so the daemon can resolve your tailnet URL and trust the `*.ts.net`
  host before the first request lands. If tailscale isn't ready, the daemon
  boots anyway on the loopback surface and `localterm restart` re-resolves once
  it's up.
- The service starts at **login**. For a headless VPS where there's no active
  session at boot, enable lingering once: `sudo loginctl enable-linger $USER`.

Manage the service directly with
`systemctl --user {status,restart,stop} localterm`; `localterm restart` and
`localterm stop` detect the active unit and go through systemd.

## URL surfaces

`localterm install` also configures the optional URL surfaces (best-effort, with
actionable hints when a prerequisite is missing):

- **portless** — installs a root-owned launchd proxy on `:443` so the daemon is
  reachable at `https://localterm.localhost` (HTTPS, no port). Skipped with an
  install command if `portless` isn't on PATH.
- **Tailscale** — runs `tailscale serve --bg --https 443 localhost:<port>` so the
  daemon is reachable on your tailnet at `https://<node>.ts.net` with a real
  Let's Encrypt cert. Skipped with a hint if Tailscale isn't installed, the node
  is offline, or HTTPS certificates aren't enabled on the tailnet (enable them
  at <https://login.tailscale.com/admin/settings/features>, then re-run
  `localterm install`).

`localterm install` also wires shell tab-completion (subcommands, live session
ids, secret names) — into your shell's completion drop-directory when it has one
(fish always; zsh/bash when configured), else a guarded, lazy-loaded line in
your rc file. `localterm completions <shell> --install`/`--uninstall` wires just
one shell without the full install.

## The ssh + tmux replacement

This makes localterm a real **ssh + tmux replacement**: host the daemon on a
VPS, keep it loopback-bound, and reach it securely either over your tailnet
(`https://<node>.ts.net`, auth = Tailscale ACLs) or an
`ssh -L 3417:localhost:3417 vps` tunnel (`https://localterm.localhost`, auth =
ssh). A shell that's still doing something — producing output, or running a
foreground program even when quiet — survives the disconnect and reattaches
silently; only a truly idle shell is reaped after the ~30s grace window, so you
don't need nested `tmux` for the common case.

### Tailscale setup (one-time)

```bash
# tailscale + HTTPS certs (once)
sudo tailscale up
# enable HTTPS certs on your tailnet: https://login.tailscale.com/admin/settings/features

localterm install                       # writes the unit, enables + starts it, provisions tailscale serve
sudo loginctl enable-linger $USER        # so it starts at boot without an active session
```

Then open `https://<node>.ts.net` from any tailnet device.

### ssh-tunnel setup (prefer over Tailscale)

`localterm install` still auto-starts the daemon — its tailscale step is
best-effort (it just prints a hint if tailscale isn't installed). From your
laptop run `ssh -L 3417:localhost:3417 vps`, then open
`https://localterm.localhost`. The daemon stays loopback-bound; ssh is the only
ingress and the auth.
