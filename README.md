# localterm

[![version](https://img.shields.io/npm/v/@monotykamary/localterm?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)
[![downloads](https://img.shields.io/npm/dt/@monotykamary/localterm.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)

Your terminal should just be a browser tab.

Run `npx @monotykamary/localterm@latest start` and every browser tab is one shell. Open a new tab to spawn another. Close the tab to kill it. That's the whole product.

![demo](https://www.localterm.dev/demo.png)

## Install

Run this command anywhere:

```bash
npx @monotykamary/localterm@latest start
```

This boots a local daemon and opens [`http://localterm.localhost:3417`](http://localterm.localhost:3417) in your browser. (`*.localhost` is reserved by [RFC 6761](https://datatracker.ietf.org/doc/html/rfc6761) and resolves to `127.0.0.1` in every modern browser, so no `/etc/hosts` edit needed.)

To install globally:

```bash
npm install -g @monotykamary/localterm
localterm start
```

## Usage

The mental model is **shell = browser tab**:

- **New tab** → new shell
- **Close tab** → shell dies immediately
- **Reload tab** → fresh shell (the prior one is gone)

Reloads and connection drops spawn a fresh shell (auto-reconnect is built in for transport failures). If you want a long-lived shell that survives reloads, run `tmux` _inside_ localterm.

## CLI

```bash
localterm start [-p 3417] [-H 127.0.0.1] [--open]   # daemonizes by default
localterm stop
localterm status
localterm restart
localterm install [-p 3417] [-H 127.0.0.1]  # auto-start at login (macOS)
localterm uninstall                              # remove auto-start service
```

State lives in `~/.localterm/` (PID, port, server log at `~/.localterm/server.log`).

## Auto-start (macOS)

`localterm install` creates a [launchd](https://support.apple.com/guide/terminal/launchd-apda4e235115/2.14/mac/14.1) plist in `~/Library/LaunchAgents/` with `RunAtLoad` and `KeepAlive` enabled:

- **RunAtLoad** — localterm starts automatically when you log in.
- **KeepAlive** — launchd restarts the daemon immediately if it crashes.

One-time setup:

```bash
npx @monotykamary/localterm@latest install
# or with a global install:
localterm install
```

Remove with `localterm uninstall`.

## Automations

Schedule commands as server-managed jobs. When one is due, localterm opens a new browser tab in the automation's directory and runs the command in a fresh shell — the tab stays open afterwards so you can see that it ran and whether it succeeded. The tab opens in the **background** so a scheduled run never steals your focus (via the DevTools Protocol over a connection opened once at start when a Chromium browser has remote debugging on, otherwise the OS opener / macOS `open -g`; set `LOCALTERM_DISABLE_CDP_TABS=1` to force the fallback).

- Open the full-screen panel from the top-right toolbar (calendar icon) or with <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>.
- Build schedules from friendly presets — daily, weekdays/weekends, specific days, multiple times a day, every N minutes/hours — with raw 5-field cron available as an advanced escape hatch. Evaluated in local time.
- Or trigger on a **folder change** instead of a schedule — the job runs when its directory changes, detected via native filesystem events (no polling). Bursts are debounced into one run and a new run won't start while a previous one is still going, so a command that writes into the watched folder won't loop.
- Cap a job with a run limit ("stop after N runs"); when reached it's marked **finished** and stays listed until you reset it. Or let it run forever.
- Toggle **Close tab when finished** to have a run's tab close once its command exits (best-effort; needs the CDP background-tab path). Off by default — tabs stay open so you can see what ran.
- A **recent runs** view and a per-automation history show which runs succeeded, failed, were missed, or were **skipped** because the machine was asleep at that scheduled time (reconstructed when the daemon next starts).
- Definitions persist in `~/.localterm/automations.json` (auto-migrated from older versions; a sibling `~/.localterm/daemon-heartbeat.json` records liveness for downtime detection); the daemon must be running for jobs to fire.
- Everything is also available over HTTP at `/api/automations` (list/create/update/delete/run-now/reset).

Agents can manage automations too — install the API playbook as a skill with [`skills`](https://github.com/vercel-labs/skills):

```bash
npx skills add monotykamary/localterm
```

## Security

- By default, binds loopback (`127.0.0.1`) and enforces loopback `Host`/`Origin` headers to defeat DNS-rebinding and cross-origin attacks.
- Pass `-H 0.0.0.0` (or any non-loopback address) to expose the server on all network interfaces. In this mode, `Host`/`Origin` must be from a private network (RFC 1918, CGNAT/Tailscale `100.64.127.x`, link-local, `*.localhost`) and WebSocket source IPs are filtered to private ranges — only use on trusted networks.
- One PTY per WebSocket. Closing the tab kills the shell — no orphaned processes.

## Resources & Contributing Back

Looking to contribute back? Check out the [Contributing Guide](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md) and [`AGENTS.md`](https://github.com/monotykamary/localterm/blob/main/AGENTS.md) for code style.

Find a bug? Head over to our [issue tracker](https://github.com/monotykamary/localterm/issues) and we'll do our best to help. We love pull requests, too!

[**→ Start contributing on GitHub**](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md)

### License

localterm is MIT-licensed open-source software.
