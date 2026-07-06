# localterm

[![version](https://img.shields.io/npm/v/@monotykamary/localterm?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)
[![downloads](https://img.shields.io/npm/dt/@monotykamary/localterm.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)

Your terminal should just be a browser tab.

Run `npx @monotykamary/localterm@latest start` and every browser tab is one shell. Open a new tab to spawn another. Close a tab and its shell waits in the session switcher (top-right) for a short grace window — switch back to it in that window, or it's reaped. That's the whole product.

![demo](https://www.localterm.dev/demo.png)

## Install

```bash
npx @monotykamary/localterm@latest start
```

This boots a local daemon and opens a browser tab. The URL depends on what's
installed on the machine — `localterm status` shows the active one:

| Surface      | URL                               | Requires                                                                                                                                  |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **tailnet**  | `https://<your-node>.ts.net`      | [Tailscale](https://tailscale.com) connected, HTTPS certs enabled for the tailnet                                                         |
| **local**    | `https://localterm.localhost`     | `portless` (installed via `localterm install`)                                                                                            |
| **loopback** | `http://localterm.localhost:3417` | nothing — `.localhost` resolves to `127.0.0.1` via [RFC 6761](https://datatracker.ietf.org/doc/html/rfc6761), no `/etc/hosts` edit needed |

To install globally: `npm install -g @monotykamary/localterm && localterm start`.

## Usage

The mental model is **shell = browser tab**:

- **New tab** → new shell.
- **Close tab** → the shell detaches and waits in the session switcher (top-right) for ~30s; reattach in that window or it's reaped. A shell still producing output (a build) or running a foreground program (a `sleep`) is kept alive, so a closed tab never kills a running command.
- **Reload tab** → fresh shell (the prior one waits in the switcher like a closed tab).
- **Switch** → the session switcher (top-right, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>I</kbd>) re-points this tab at any live shell; search by title, path, or shell.

Transient connection drops silently reattach to the same shell. If you want a shell that survives a full page reload in the _same_ tab, run `tmux` _inside_ localterm. → full model in [Usage](docs/usage.md).

## Features

|                                                         |                                                                                                                                                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🐚 [**Shells**](docs/shells.md)                         | Pick a shell per tab, per CLI call, or globally (`LOCALTERM_SHELL`); login profiles + OSC 7 / git-dirty hooks for zsh, bash, fish.                                      |
| 🎨 [**Themes & fonts**](docs/appearance.md)             | 19 built-in themes (16 dark + 3 light) + **Auto (system)**; import your own (JSON or iTerm `.itermcolors`); 11 bundled fonts + a custom system Nerd Font — all offline. |
| ⏰ [**Automations**](docs/automations.md)               | Scheduled + folder-watch + event + webhook jobs; shell or headless agent runners; background tabs.                                                                      |
| 🚀 [**Auto-start & remote access**](docs/auto-start.md) | launchd (macOS) / systemd user unit (Linux); Tailscale or an ssh tunnel turns a VPS into an ssh + tmux replacement.                                                     |
| 🔐 [**Identity & SSO**](docs/identity.md)               | Multi-user access via `header` (reverse proxy), `passkey` (WebAuthn), or `oidc`.                                                                                        |
| 🤖 [**pi integration**](docs/pi.md)                     | Kitty graphics + OSC 8 links, and secret scrubbing for pi's bash tool.                                                                                                  |
| 🛡️ [**Security**](docs/security.md)                     | Loopback-bound by default; DNS-rebinding defense; safe sharing.                                                                                                         |

## CLI

```bash
localterm start [-p 3417] [-H 127.0.0.1] [--open]   # daemonizes by default
localterm stop | status | restart
localterm install                                  # auto-start service + URL surfaces + completions
localterm exec "<cmd>" [--cwd <path>] [--shell <path>] [--json]   # one-shot: run, capture, exit with its code
localterm session new|ls|attach|exec|capture|kill <id> …           # tmux-parity PTY control
localterm secret list|get|set|delete <name>                       # Keychain-backed per-program secrets
```

State lives in `~/.localterm/` (PID, port, server log at `~/.localterm/server.log`). → full reference in [CLI](docs/cli.md).

## Resources & contributing

- 🐛 [Issue tracker](https://github.com/monotykamary/localterm/issues) · 💬 [Pull requests welcome](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md)
- 📖 [**Full docs**](docs/README.md) · 🤝 [Contributing guide](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md) · 📝 [AGENTS.md](https://github.com/monotykamary/localterm/blob/main/AGENTS.md) (code style)

### License

localterm is MIT-licensed open-source software.
