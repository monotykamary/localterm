# localterm

A browser-based terminal: one browser tab is one PTY session. Persistent xterm.js front-end, hono + node-pty back-end. pnpm monorepo built on [vite-plus](https://github.com/voidzero-dev/vite-plus) and [turbo](https://turbo.build).

The mental model is "shell = browser tab". Spawn another shell by opening a new browser tab and visiting localterm again; close a tab to retire its shell (the daemon reaps it after a short grace window). Reload restores the same shell because the page writes its session id into the URL path, e.g. `http://localterm.localhost:3417/jolly-chipmunk-trea`.

## Quick start

```bash
pnpm install
pnpm build
pnpm start
```

Opens `http://localterm.localhost:3417` in your browser. (`*.localhost` is reserved by RFC 6761 and resolves to `127.0.0.1` in every modern browser, so no `/etc/hosts` edit needed.) `Ctrl+C` stops the daemon and tears down all sessions. Pass CLI flags through with `pnpm start -- --no-open`.

## CLI

From inside the repo, every subcommand is reachable as `pnpm cli <subcommand>`. If you've installed localterm globally with `pnpm link --global packages/cli`, the same subcommands work as `localterm <subcommand>`.

```bash
pnpm cli start [-p 3417] [-H 127.0.0.1] [--no-open]   # alias of `pnpm start`
pnpm cli stop
pnpm cli status
pnpm cli restart        # detached restart, logs to ~/.localterm/server.log
pnpm cli list           # ls
pnpm cli new [-c cwd] [-s shell]
pnpm cli kill <id>
```

State lives in `~/.localterm/` (PID, port, server log).

`localterm` only binds loopback hosts (`127.0.0.1`, `localhost`, `*.localhost`, `::1`); non-loopback values are rejected. All `/api` and `/ws` routes additionally check the `Host` and `Origin` headers to defeat DNS-rebinding attacks.

## Structure

```
apps/
  web/          # vite + react + tailwind v4 + xterm.js
packages/
  server/       # hono + ws + node-pty + headless xterm (state mirror, idle reaper)
  cli/          # commander entry: start/stop/status/restart/list/new/kill
```

The server keeps a `@xterm/headless` instance per session, fed from every PTY chunk. On reconnect, the WebSocket sends a `serialize()` snapshot before live output resumes, so reloading the page (or even restarting the browser) restores vim/htop/less state exactly.

## Scripts

- `pnpm build`: turbo build (web, then server, then cli)
- `pnpm dev`: turbo watch all packages
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format`

See `AGENTS.md` for code style and `CONTRIBUTING.md` for the contribution flow.
