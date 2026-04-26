# localterm

A browser-based terminal hub: persistent PTY sessions on the server, xterm.js + shadcn UI in the browser. Built as a pnpm monorepo on top of [vite-plus](https://github.com/voidzero-dev/vite-plus) and [turbo](https://turbo.build).

## Quick start

```bash
pnpm install
pnpm build
pnpm exec localterm start
```

Opens `http://127.0.0.1:3417` in your browser. `Ctrl+C` stops the daemon and tears down all sessions.

## CLI

```bash
localterm start [-p 3417] [-H 127.0.0.1] [--no-open]
localterm stop
localterm status
localterm restart        # detached restart, logs to ~/.localterm/server.log
localterm list           # ls
localterm new [-c cwd] [-s shell]
localterm kill <id>
```

State lives in `~/.localterm/` (PID, port, server log).

`localterm` only binds loopback hosts (`127.0.0.1`, `localhost`, `::1`); non-loopback values are rejected. All `/api` and `/ws` routes additionally check the `Host` and `Origin` headers to defeat DNS-rebinding attacks.

## Keybindings

The browser captures `Cmd+T` and `Cmd+W` before the page can see them, so install as a PWA / standalone window if you want full keyboard control. The shortcuts the page can intercept:

- `Cmd/Ctrl+F` — find in active terminal
- `Cmd/Ctrl+1` … `Cmd/Ctrl+9` — jump to tab N
- `Cmd/Ctrl+Shift+]` / `Cmd/Ctrl+Shift+[` — next / previous tab
- Middle click on a tab — close it
- `Esc` — close find bar

## Structure

```
apps/
  web/          # vite + react + tailwind v4 + shadcn + xterm.js
packages/
  server/       # hono + ws + node-pty + headless xterm (state mirror)
  cli/          # commander entry: start/stop/status/restart/list/new/kill
```

The server keeps a `@xterm/headless` instance per session, fed from every PTY chunk. On reconnect, the WebSocket sends a `serialize()` snapshot before live output resumes — so reloading the page (or even restarting the browser) restores vim/htop/less state exactly.

## Scripts

- `pnpm build` — turbo build (web → server → cli)
- `pnpm dev` — turbo watch all packages
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm format`

See `AGENTS.md` for code style and `CONTRIBUTING.md` for the contribution flow.
