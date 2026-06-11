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
localterm start [-p 3417] [-H 127.0.0.1] [--no-open]   # daemonizes by default
localterm stop
localterm status
localterm restart
```

State lives in `~/.localterm/` (PID, port, server log at `~/.localterm/server.log`).

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
