# localterm aggregator

A lightweight workspace + tab manager for [localterm](../../) sessions. Aggregates multiple localterm terminals into a single browser page, synced across devices via localterm's native multi-client attach.

## What it does

- **Workspaces**: group terminals by project/repo (add via path input)
- **Tabs**: each tab is a real localterm session, embedded via iframe
- **Cross-device sync**: shared state (`state.json` + 3s polling) keeps workspace/tab layout in sync across all devices
- **Native multi-client**: every device opens the same `?sid=<uuid>` — localterm handles the rest (scrollback replay + live fan-out, including TUI apps)

## How it works

```
Browser (laptop/phone)
  └─ aggregator page (:8090)
       └─ iframe → localterm ?sid=<uuid> (:443 via Tailscale, or :3417 direct)
                   └─ localterm multi-client attach (scrollback replay + live output)
                       └─ shared PTY (bash + agent)
```

The aggregator server (`server.py`) is a thin Python HTTP server that:
1. Serves `index.html` and static files
2. Manages shared state (`state.json`) via `/api/state` (GET/POST)
3. Creates localterm sessions via `localterm session new --json` → `/api/new-session`
4. Kills sessions via `localterm session kill` → `/api/kill-session`

No tmux, no WebSocket proxying, no custom terminal emulation — just localterm's built-in multi-client.

## Quick start

```bash
# 1. Ensure localterm is running
localterm serve &

# 2. Start the aggregator
python3 apps/aggregator/server.py

# 3. Open in browser
# If localterm is on the same host (e.g. via Tailscale serve on :443):
open http://localhost:8090

# If localterm is on a different port:
open "http://localhost:8090?lt=http://localhost:3417"
```

## Configuration

| Query param | Default | Purpose |
|---|---|---|
| `lt` | same host, default port | localterm base URL (e.g. `http://localhost:3417`) |
| `home` | `/` | default cwd for the initial workspace |

## With Tailscale

```bash
# Serve localterm on :443
tailscale serve --bg 3417

# Serve the aggregator on :8090
tailspal serve --bg 8090

# Open from any device on the tailnet:
# https://<hostname>.ts.net:8090/
```

## Architecture

- `server.py` — Python HTTP server (stdlib only, no dependencies)
- `index.html` — Single-file SPA (vanilla JS, no build step)
- `state.json` — Shared state (auto-created, gitignored)

The aggregator is intentionally framework-free: no Node.js, no build step, no dependencies beyond Python 3 and a running localterm instance. This makes it easy to deploy alongside localterm on any machine.
