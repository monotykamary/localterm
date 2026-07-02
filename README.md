# localterm

[![version](https://img.shields.io/npm/v/@monotykamary/localterm?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)
[![downloads](https://img.shields.io/npm/dt/@monotykamary/localterm.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/@monotykamary/localterm)

Your terminal should just be a browser tab.

Run `npx @monotykamary/localterm@latest start` and every browser tab is one shell. Open a new tab to spawn another. Close a tab and its shell waits in the session switcher (top-right) for a short grace window — switch back to it in that window, or it's reaped. That's the whole product.

![demo](https://www.localterm.dev/demo.png)

## Install

Run this command anywhere:

```bash
npx @monotykamary/localterm@latest start
```

This boots a local daemon and opens a browser tab. The URL depends on what's
installed on the machine — `localterm status` shows the active one:

| Surface      | URL                               | Requires                                                                                                                                  |
| ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **tailnet**  | `https://<your-node>.ts.net`      | [Tailscale](https://tailscale.com) connected, HTTPS certs enabled for the tailnet                                                         |
| **local**    | `https://localterm.localhost`     | `portless` (workspace dev dep) — installed via `localterm install`                                                                        |
| **loopback** | `http://localterm.localhost:3417` | nothing — `.localhost` resolves to `127.0.0.1` via [RFC 6761](https://datatracker.ietf.org/doc/html/rfc6761), no `/etc/hosts` edit needed |

To install globally:

```bash
npm install -g @monotykamary/localterm
localterm start
```

## Usage

The mental model is **shell = browser tab**, but a tab is just a view onto a shell that outlives it for a grace window:

- **New tab** → new shell (one authority spawns it)
- **Close tab** → the shell detaches and waits (dormant) in the session switcher (top-right) for ~30s; reattach in that window (from this tab or another joining alongside) or it's reaped — no zombies. A dormant shell that's still producing output (a build, a long command), or still running a foreground program even when quiet (a `sleep`, a paused build), is kept alive, so a closed tab never kills a running command mid-stream.
- **Reload tab** → fresh shell for this tab (the prior one waits in the switcher like any closed tab)
- **Switch** → the session switcher re-points this tab at any live shell; the one you left detaches and waits its grace window

Transient connection drops silently reattach to the same shell (auto-reconnect is built in for transport failures). A shell nobody is viewing is reaped once it's truly idle — a shell still producing output, or still running a foreground program even when quiet, is kept alive even with no viewers, and only an idle one dies within the grace window. Kill the ones you're done with sooner from the switcher. If you want a shell that survives a full page reload in the _same_ tab, run `tmux` _inside_ localterm.

### Sessions

The session switcher (top-right, or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>I</kbd>) lists every live shell — the one this tab is viewing, others attached in different tabs, and dormant ones waiting out their grace window. Each row's terminal icon is colored by activity, matching the tab favicon: green while output is streaming, blue while a foreground program runs quietly, grey when idle at the prompt. Click a row to switch this tab onto that shell; hover a row to kill it. Search by title, path, or shell. It's also in the command palette (<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> → Sessions).

## CLI

```bash
localterm start [-p 3417] [-H 127.0.0.1] [--open]   # daemonizes by default
localterm stop
localterm status
localterm restart
localterm install [-p 3417] [-H 127.0.0.1]  # auto-start (launchd on macOS, systemd user unit on Linux)
localterm uninstall                              # remove auto-start service
localterm exec "<command>" [--cwd <path>] [--timeout 60] [--json]  # one-shot: run, capture, exit with its code
localterm session ls [--json]                    # list live PTYs
localterm session new [--cwd <path>] [--cmd <c>] [--name <t>] [--no-pin] [--json]  # spawn a detached shell
localterm session attach <id>                    # open a browser tab onto a shell
localterm session exec <id> "<cmd>" [--timeout 60] [--json]  # run in a persistent session
localterm session send-keys <id> '<keys>'        # raw input (\n=Enter, \x03=Ctrl-C)
localterm session press <id> <keys...>           # named keys: F2, Ctrl-C, Escape : w q Enter
localterm session capture <id> [--lines 200] [--json]  # rendered screen (tmux capture-pane -p)
localterm session capture <id> --png -o shot.png # screenshot via the browser (CDP)
localterm session wait <id> --text "done" [--timeout 10] [--json]  # block until the pane matches
localterm session mouse click <id> --on-text OK | --col N --row N  # drive mouse-first TUIs
localterm session mouse drag|move|scroll <id> …   # drag/move/scroll gestures
localterm session resize <id> --cols 120 --rows 40
localterm session rename <id> <name>
localterm session pin <id> | unpin <id>           # toggle idle-reap exemption
localterm session kill <id>
localterm secret list                            # per-program secrets (names + policy; never values)
localterm secret get <name>                       # print a value (resolved from Keychain, not the daemon)
localterm secret set <name> -e <VAR> [-p a,b] [-v <value>|-]  # -v - reads stdin
localterm secret delete <name>
```

`exec` and the `localterm session` group are the tmux-parity surface for users
and AI agents — drive PTYs headlessly over the CLI and the matching REST API
(`POST /api/sessions`, `POST /api/sessions/:id/{input,resize,exec}`, `GET
/api/sessions/:id/pane`, `POST /api/exec`). REST-created sessions are **pinned**
by default (exempt from the idle reap) so an agent's shell survives between
calls; `exec` is synchronous — one call returns a command's captured output and
exit code, the LLM-ergonomic upgrade over tmux's fire-and-forget `send-keys`.
`press` sends named keys, `wait` blocks until the pane matches, `capture --png`
screenshots the terminal via the daemon's existing CDP socket (the browser is
the rasterizer — no new dep), and `mouse` drives mouse-first TUIs (NetHack,
dialog installers, `mc`) through the viewer's xterm.js with an SGR fallback for
true headless. See the `localterm session` skill reference for the full surface.

State lives in `~/.localterm/` (PID, port, server log at `~/.localterm/server.log`).

## Auto-start (macOS)

`localterm install` creates a [launchd](https://support.apple.com/guide/terminal/launchd-apda4e235115/2.14/mac/14.1) plist in `~/Library/LaunchAgents/` with `RunAtLoad` and `KeepAlive` enabled:

- **RunAtLoad** — localterm starts automatically when you log in.
- **KeepAlive** — launchd restarts the daemon immediately if it crashes.

The same command also configures the optional URL surfaces (best-effort, with
actionable hints when a prerequisite is missing):

- **portless** — installs a root-owned launchd proxy on `:443` so the daemon
  is reachable at `https://localterm.localhost` (HTTPS, no port). Skipped with
  an install command if `portless` isn't on PATH.
- **Tailscale** — runs `tailscale serve --bg --https 443 localhost:<port>` so
  the daemon is reachable on your tailnet at `https://<node>.ts.net` with a
  real Let's Encrypt cert. Skipped with a hint if Tailscale isn't installed,
  the node is offline, or HTTPS certificates aren't enabled on the tailnet
  (enable them at <https://login.tailscale.com/admin/settings/features>, then
  re-run `localterm install`).

One-time setup:

```bash
npx @monotykamary/localterm@latest install
# or with a global install:
localterm install
```

Remove with `localterm uninstall` (also tears down the Tailscale serve rule).

## Auto-start (Linux)

`localterm install` writes a [systemd](https://systemd.io/) **user unit** at `~/.config/systemd/user/localterm.service` (the per-user mirror of the macOS LaunchAgent — no root required, state stays in `~/.localterm/`), runs `systemctl --user daemon-reload` and `enable --now`, and runs the same Tailscale step as on macOS:

- **`Restart=on-failure`** — the daemon restarts immediately if it crashes, but a clean `localterm stop` stays stopped (crash-only, matching the macOS `KeepAlive`).
- **`After=network-online.target tailscaled.service`** + an `ExecStartPre` that waits up to 30s for `tailscale status` to answer (only when tailscale is installed), so the daemon can resolve your tailnet URL and trust the `*.ts.net` host before the first request lands. If tailscale isn't ready, the daemon boots anyway on the loopback surface and `localterm restart` re-resolves once it's up.
- The service starts at **login**. For a headless VPS where there's no active session at boot, enable lingering once: `sudo loginctl enable-linger $USER`.

This makes localterm a real **ssh + tmux replacement**: host the daemon on a VPS, keep it loopback-bound, and reach it securely either over your tailnet (`https://<node>.ts.net`, auth = Tailscale ACLs) or an `ssh -L 3417:localhost:3417 vps` tunnel (`https://localterm.localhost`, auth = ssh). A shell that's still doing something — producing output, or running a foreground program even when quiet — survives the disconnect and reattaches silently; only a truly idle shell is reaped after the ~30s grace window, so you don't need nested `tmux` for the common case.

One-time setup on a Linux VPS:

```bash
# tailscale + HTTPS certs (once)
sudo tailscale up
# enable HTTPS certs on your tailnet: https://login.tailscale.com/admin/settings/features

localterm install                       # writes the unit, enables + starts it, provisions tailscale serve
sudo loginctl enable-linger $USER        # so it starts at boot without an active session
```

Then open `https://<node>.ts.net` from any tailnet device. Manage the service directly with `systemctl --user {status,restart,stop} localterm`; `localterm restart` and `localterm stop` detect the active unit and go through systemd. Remove with `localterm uninstall` (disables the unit and tears down the Tailscale serve rule).

Prefer an ssh tunnel over Tailscale? `localterm install` still auto-starts the daemon — its tailscale step is best-effort (it just prints a hint if tailscale isn't installed). From your laptop run `ssh -L 3417:localhost:3417 vps`, then open `https://localterm.localhost`. The daemon stays loopback-bound; ssh is the only ingress and the auth.

## Identity & multi-user access (SSO)

By default localterm is a single authority — the daemon is loopback-bound and whoever can reach it (you, over your tailnet or an ssh tunnel) gets full access with no login. For a shared gateway where several people should reach the daemon but only their own shells, configure an **identity provider** with `localterm config identity <provider>`, then restart. The daemon then resolves an identity per request and partitions the session switcher by user (a cross-tenant id surfaces as not-found).

Three providers, from no-work to self-contained:

| Provider      | Who authenticates                                                                                                   | Use when                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **`header`**  | An identity-aware reverse proxy in front (Cloudflare Access, Pomerium, Caddy + OAuth2-Proxy, Authelia forward-auth) | you already run a proxy/SSO; localterm just reads `X-Forwarded-User` it sets |
| **`passkey`** | localterm itself, via WebAuthn (a passkey tap)                                                                      | you want self-contained SSO with no external IdP                             |
| **`oidc`**    | Any OIDC IdP (Google, GitHub, or self-hosted Authentik/Zitadel/Keycloak)                                            | you want to reuse an existing IdP                                            |

`header` trusts the identity header only when the request's source IP is in a `trustedProxy` allowlist (default `loopback` — the proxy runs on the same host; pass `10.0.0.0/8`, `private`, or a CIDR for a remote proxy). A trusted-proxy request with no header is the **operator tier** (full access — the CLI from loopback and the daemon's own automation keep working).

`passkey` and `oidc` run their own login under `/auth/*`, issue a signed session cookie, and **reject** an unauthenticated request at the door: the terminal shows a login screen, and the daemon's own CDP viewer tabs (used by `capture-pane --png` and real-browser mouse) are minted the session's cookie so they pass the gate. The CLI can't run a WebAuthn/OIDC ceremony, so for those modes `localterm config identity` auto-generates an **operator bearer token** (printed once; stored in the config) that the CLI sends automatically — `localterm` then works as the operator with full access.

### Configure

```bash
localterm config identity header --trusted-proxy loopback        # proxy on the same host
localterm config identity passkey --registration open            # self-contained; prints an operator token
localterm config identity oidc \
  --issuer https://accounts.example.com \
  --client-id localterm --client-secret …                        # reuse an IdP
localterm restart
```

The config lives in `~/.localterm/config.json`:

```json
{
  "version": 1,
  "identity": {
    "provider": "passkey",
    "registration": "open",
    "operatorToken": "auto-generated-by-the-cli"
  }
}
```

### OIDC example (Google)

Register a client at Google Cloud Console → APIs & Services → Credentials → OAuth client (Web application), with the redirect URI `https://<node>.ts.net/auth/oidc/callback` (the daemon's announced origin + `/auth/oidc/callback` — so OIDC needs a stable announced origin like your tailnet URL, unlike passkey which binds to whatever origin the browser is on). Then:

```bash
localterm config identity oidc \
  --issuer https://accounts.google.com \
  --client-id …apps.googleusercontent.com \
  --client-secret …
localterm restart
```

Open `https://<node>.ts.net` — the login screen redirects through Google and back, and the session cookie keeps you signed in across tabs.

### Notes

- Identity is built once at daemon start, so changing it needs a `localterm restart` (unlike `cdpPort`/`graceSeconds`, which are live).
- `passkey` needs a WebAuthn-capable browser; `oidc` needs a stable announced origin (a registered redirect URI). On a loopback-only `http://localhost:port` surface (dynamic port, not registerable), neither works — use `header`, or expose the daemon on a tailnet/https origin first.

### Dev server (workspace contributors)

`pnpm dev` runs the terminal's Vite dev server through portless at
`https://dev.localterm.localhost` (the daemon's `https://localterm.localhost`
hostname is reserved for the built daemon). The two `tsc --watch` packages keep
running in parallel via turbo. Escape hatch: `pnpm dev:app` runs `vp dev`
without portless.

### `localterm` binary from the working copy (workspace contributors)

Iterating via `pnpm cli` is fast but leaves no `localterm` binary on PATH, so
anything that calls `localterm ...` (scripts, docs, muscle memory) won't work.
Link the CLI globally from your checkout to get the binary without giving up
live rebuilds:

```bash
pnpm setup                         # once, if PNPM_HOME isn't configured yet
pnpm link --global ./packages/cli  # from the repo root, so the workspace dep resolves
```

The shim runs `packages/cli/dist/index.js` straight out of the checkout, so
`pnpm build` / `pnpm dev` rebuilds land on the next `localterm` call — no
reinstall. Unlink with `pnpm remove --global @monotykamary/localterm`.

Two gotchas:

- `pnpm link` also writes a `link:` dependency into `package.json`,
  `packages/cli/package.json`, and `pnpm-workspace.yaml` (and rewrites the
  latter's `allowBuilds`). Those are side effects, not intended edits — revert
  them so they don't get committed; the global shim lives in
  `~/Library/pnpm/bin` and is unaffected:

  ```bash
  git checkout -- package.json packages/cli/package.json pnpm-workspace.yaml pnpm-lock.yaml
  rm -f packages/cli/pnpm-workspace.yaml
  ```

- `prepack` (the `apps/terminal/dist` → `packages/cli/terminal` copy that ships
  the UI with the tarball) runs only on `pnpm pack` / `pnpm publish`, **not** on
  `pnpm build`. After a terminal-UI change, sync it manually; pure cli/server TS
  changes just need `pnpm build` since `localterm` reads `dist` live:

  ```bash
  pnpm build
  pnpm --filter @monotykamary/localterm run prepack
  ```

## Automations

Schedule commands as server-managed jobs. When one is due, localterm opens a new browser tab in the automation's directory and runs the command in a fresh shell — the tab stays open afterwards so you can see that it ran and whether it succeeded. The tab opens in the **background** so a scheduled run never steals your focus (via the DevTools Protocol over a connection opened once at start when a Chromium browser has remote debugging on, otherwise the OS opener / macOS `open -g`; set `LOCALTERM_DISABLE_CDP_TABS=1` to force the fallback).

Enable remote debugging by launching your browser with `--remote-debugging-port=9222` (e.g. `open -na "Google Chrome" --args --remote-debugging-port=9222`), or by toggling "Discover network targets" in `chrome://inspect`; localterm auto-detects any debug-enabled Chromium in a known user-data dir (Chrome, Chromium, Edge, Brave, Arc, Vivaldi, Opera, Comet, Dia, **Aside**, Canary) by reading its `DevToolsActivePort` file, most-recently-launched first. To pin a specific port instead (e.g. Aside's `52860` when several browsers are running), set **Settings → Automation browser → Remote debugging port**; the daemon probes that port first (`/json/version`, falling back to the matching `DevToolsActivePort` file for browsers that don't serve it — Chrome 144+, Dia, Aside) and falls back to auto-detect when it's unreachable. `localterm status` shows whether the daemon is currently connected via CDP, and `localterm install` checks for a debug-enabled browser as part of its setup checklist.

- Open the full-screen panel from the top-right toolbar (calendar icon) or with <kbd>⌘J</kbd> / <kbd>Ctrl+J</kbd>.
- Build schedules from friendly presets — daily, weekdays/weekends, specific days, multiple times a day, every N minutes/hours — with raw 5-field cron available as an advanced escape hatch. Evaluated in local time.
- Or trigger on a **folder change** instead of a schedule — the job runs when its directory changes, detected via native filesystem events (no polling). Bursts are debounced into one run and a new run won't start while a previous one is still going, so a command that writes into the watched folder won't loop.
- Cap a job with a run limit ("stop after N runs"); when reached it's marked **finished** and stays listed until you reset it. Or let it run forever.
- Toggle **Close tab when finished** to have a run's tab close once its command exits (needs the CDP background-tab path; the toggle is locked off until a debug-enabled Chromium is connected). Off by default — tabs stay open so you can see what ran.
- A **recent runs** view and a per-automation history show which runs succeeded, failed, were missed, or were **skipped** because the machine was asleep at that scheduled time (reconstructed when the daemon next starts).
- Definitions persist in `~/.localterm/automations.json` (auto-migrated from older versions; a sibling `~/.localterm/daemon-heartbeat.json` records liveness for downtime detection); the daemon must be running for jobs to fire.
- Everything is also available over HTTP at `/api/automations` (list/create/update/delete/run-now/reset).

Agents can manage automations too — install the API playbook as a skill with [`skills`](https://github.com/vercel-labs/skills):

```bash
npx skills add monotykamary/localterm
```

## pi integration

[pi](https://github.com/earendil-works/pi-coding-agent) runs first-class inside localterm. The `@monotykamary/pi-localterm` extension wires the two together with two features, both inert outside localterm:

- **Kitty graphics + OSC 8 links** — localterm's xterm.js renderer supports the Kitty graphics protocol and OSC 8 hyperlinks, but sets `TERM=xterm-256color` so pi-tui can't detect them. The extension force-enables them so images and links render in the browser.
- **Secret scrubbing for pi's bash tool** — localterm injects each secret only into the shimmed process's env (pi's), but pi's bash tool spawns commands with `{ ...process.env }`, so without the extension the agent's commands would inherit every secret pi received. The extension overrides the `bash` tool with a spawn hook that strips the `pi` process's localterm-managed secret env vars from each command's child env — pi's own env (and its provider calls) keep them. This is defense-in-depth, not a hard barrier (see the package README for the threat model).

Install from npm:

```bash
pi install npm:@monotykamary/pi-localterm
```

Or from source:

```bash
git clone https://github.com/monotykamary/localterm
pi -e ./localterm/packages/pi-extension
```

See [`packages/pi-extension/README.md`](./packages/pi-extension/README.md) for the full install guide, how the scrub mirrors the shim 1:1, and what it does and doesn't protect against.

## Security

- By default, binds loopback (`127.0.0.1`) and enforces loopback `Host`/`Origin` headers to defeat DNS-rebinding and cross-origin attacks.
- To share the daemon across machines, prefer `localterm install`'s Tailscale step — it surfaces the daemon on your tailnet at `https://<node>.ts.net` over a real Let's Encrypt cert, on an end-to-end-encrypted WireGuard mesh, with no port exposed to the public internet.
- Pass `-H 0.0.0.0` (or any non-loopback address) to expose the server on all network interfaces. In this mode, `Host`/`Origin` must be from a private network (RFC 1918, CGNAT/Tailscale `100.64.127.x`, link-local, `*.localhost`) and WebSocket source IPs are filtered to private ranges — only use on trusted networks.
- One PTY per WebSocket. Closing a tab detaches — the shell waits in the session switcher for a grace window (~30s) and is reaped if nobody reattaches; kill it sooner from the switcher.

## Resources & Contributing Back

Looking to contribute back? Check out the [Contributing Guide](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md) and [`AGENTS.md`](https://github.com/monotykamary/localterm/blob/main/AGENTS.md) for code style.

Find a bug? Head over to our [issue tracker](https://github.com/monotykamary/localterm/issues) and we'll do our best to help. We love pull requests, too!

[**→ Start contributing on GitHub**](https://github.com/monotykamary/localterm/blob/main/CONTRIBUTING.md)

### License

localterm is MIT-licensed open-source software.
