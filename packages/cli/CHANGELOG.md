# localterm

## 2.31.0

### Minor Changes

- 32f75fe: Add programmatic PTY control (tmux parity) over the REST API and the `localterm session` CLI, plus `exec` — the synchronous command+output+exit-code primitive for AI agents.

  - **Sessions**: `POST /api/sessions` (spawn a detached, pinned-by-default PTY), `GET/PATCH /api/sessions/:id` (rename/pin), `POST /api/sessions/:id/{input,resize,exec}`, `GET /api/sessions/:id/pane` (capture-pane), `DELETE /api/sessions/:id` (existing). CLI: `localterm session ls|new|attach|kill|send-keys|capture|exec|resize|rename|pin|unpin`.
  - **exec**: one-shot `POST /api/exec` / `localterm exec` (transient shell, run+capture+exit) and in-session `POST /api/sessions/:id/exec` (stateful — cwd/env/history persist across calls). Returns `{exitCode, output, timedOut, truncated, durationMs}`; the CLI propagates the exit code (text mode) or emits JSON (exits 0, code in the payload).
  - **Pinned sessions**: REST-created sessions are exempt from the idle reap and from silent eviction at the session cap, so an agent's shell survives between calls. Browser tabs keep the grace window. `--no-pin` / `pinned:false` opt out.
  - **Server-side terminal emulation**: a lazy per-session `@xterm/headless` renderer (same parser as the browser) feeds `capture-pane` and exec clean, ANSI-processed text. Loaded via `createRequire` to work around the package's missing `exports` field.
  - **Skills**: a new `references/sessions-exec.md` reference plus an updated `SKILL.md` so LLMs can drive the surface.

### Patch Changes

- Updated dependencies [32f75fe]
  - @monotykamary/localterm-server@2.31.0

## 2.30.0

### Minor Changes

- 28feb59: Add a configurable no-clients grace period (Settings → Sessions → Grace period), with an "Off" option to never reap.

  The 30s window a shell with no viewers stayed alive after its tab closed was a hardcoded constant (`SESSION_GRACE_MS`). It's now a daemon-global setting in `~/.localterm/config.json` (`graceSeconds`), edited through the same `GET`/`PUT /api/config` path as the CDP port and hydrated into the Settings modal on open.

  - `graceSeconds` is in seconds. `null` (empty field, "Off") parks a dormant shell with no timer so it lingers until killed from the session switcher or evicted at the session cap; `0` reaps an idle shell the moment its last viewer detaches; a finite value keeps the existing behavior. A shell still running a command is never reaped regardless of the window — only a truly idle one dies within it. Bounds are 0–3600s, default 30s.
  - A `PUT` re-arms every already-dormant session's grace timer via a new `SessionManager.rearmGrace()`, so a change takes effect immediately rather than only on the next detach. The manager reads the live value at each arm instead of capturing it at construction.
  - The terminal Settings modal gains a "Sessions" section (after "Launch") with a numeric field and an explanatory tooltip. The commit-on-blur numeric input is extracted from the CDP port field into a shared `ConfigNumberField` so both daemon-global knobs reuse it.

### Patch Changes

- Updated dependencies [28feb59]
  - @monotykamary/localterm-server@2.30.0

## 2.29.0

### Minor Changes

- b140b7e: Add a configurable CDP remote-debugging port for automation background tabs, plus
  Aside support and a manual Connect action.

  The daemon's CDP client auto-detected a debug-enabled Chromium by scanning known
  user-data dirs for a `DevToolsActivePort` file. Aside was missing from that list,
  so it was never found even though it writes the file into
  `~/Library/Application Support/Aside`. It's now a candidate on macOS/Linux/Windows,
  so auto-detect picks it up (the most-recently-launched browser still wins, as
  before). A new daemon config (`~/.localterm/config.json`, `cdpPort`) pins a
  specific port. When set, discovery probes `GET /json/version` first, then falls
  back to a `DevToolsActivePort` file matching that port — the only reliable path
  for browsers that don't serve `/json/version` (Chrome 144+, Dia, Aside),
  mirroring browser-harness-js's `resolveWsUrlFromPort`. The configured port is
  preferred; the file scan remains as fallback when it refuses the connection.

  - New `GET`/`PUT /api/config` reads and updates `cdpPort`. A `PUT` persists it and
    updates the live port value the daemon reads on the next connect — it does
    NOT tear down or reconnect (that's the explicit Connect button's job, or the
    startup connect), so changing the port never disrupts a working connection or
    flashes "Not connected". `/api/health`'s `cdp` field gains an optional `port`
    for the connected browser.
  - The terminal Settings modal has a new "Automation browser" section with a port
    field (empty = auto-detect) and a live "Connected — <browser>" / "Not
    connected" status. It is a daemon-global value hydrated on modal open, not a
    per-tab localStorage pref. A **Connect** button triggers an explicit, awaited
    `POST /api/cdp/connect` that surfaces the failure reason (e.g. a timed-out
    handshake hinting at an unaccepted remote-debugging prompt) instead of the
    fire-and-forget connect kicked by the port change and daemon start.
  - `localterm start` and `localterm install` probe the configured port so their
    banners name the right browser.

### Patch Changes

- Updated dependencies [b140b7e]
  - @monotykamary/localterm-server@2.29.0

## 2.28.2

### Patch Changes

- Updated dependencies [6b28952]
  - @monotykamary/localterm-server@2.28.2

## 2.28.1

### Patch Changes

- Updated dependencies [dd27c3f]
  - @monotykamary/localterm-server@2.28.1

## 2.28.0

### Minor Changes

- 8ce3b25: Bring `localterm install`/`uninstall` to Linux with a systemd **user unit** — the per-user mirror of the macOS LaunchAgent — so the daemon can be hosted on a VPS as an ssh + tmux replacement.

  - `localterm install` now writes `~/.config/systemd/user/localterm.service` on Linux, runs `systemctl --user daemon-reload && enable --now`, and reuses the same Tailscale serve step as macOS to surface the daemon on the tailnet at `https://<node>.ts.net`. The unit is crash-only (`Restart=on-failure`: restarts on crash, but a clean `localterm stop` stays stopped), starts at login, and boots `After=network-online.target tailscaled.service` with an `ExecStartPre` that waits up to 30s for `tailscale status` (skipped entirely if tailscale isn't installed) so the daemon resolves the tailnet URL and trusts the `*.ts.net` host before the first request lands.
  - `localterm restart`/`stop` detect the active user unit and route through `systemctl --user` (matching the existing launchd branches), falling back to the PID-based path when systemd isn't managing the daemon.
  - On a headless VPS, `sudo loginctl enable-linger $USER` starts the service at boot without an active session. The daemon stays loopback-bound; ingress is the tailnet (Tailscale ACLs) or an `ssh -L 3417:localhost:3417` tunnel (ssh is the auth).
  - Added a Linux e2e harness (`harness/linux-vps/`) that builds the whole workspace in a Debian container and verifies `localterm install` writes the unit (degrading gracefully with no systemd/tailscale/chromium — hints, not errors), the daemon serves `/api/health` on loopback, and `status`/`stop` work over the PID path.

### Patch Changes

- @monotykamary/localterm-server@2.28.0

## 2.27.4

### Patch Changes

- Updated dependencies [6258fb9]
  - @monotykamary/localterm-server@2.27.4

## 2.27.3

### Patch Changes

- Updated dependencies [1728fd6]
  - @monotykamary/localterm-server@2.27.3

## 2.27.2

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.27.2

## 2.27.1

### Patch Changes

- e93c493: Reap empty project folders left in `~/.localterm/worktrees/` after a stale worktree is swept. `git worktree remove` deletes the worktree but leaves its `~/.localterm/worktrees/<project>/` folder holding only the `.localterm-repo-id` marker; the sweep now removes that folder once it's empty (never when a sibling worktree or any other file remains), so the shared dir no longer accumulates dead project folders.
- Updated dependencies [e93c493]
  - @monotykamary/localterm-server@2.27.1

## 2.27.0

### Minor Changes

- 727c493: Flip secret injection from secret-centric to process-centric, mirroring the automations multi-select flow.

  Secrets used to carry the binaries they shims (`secret = { name, envVar, programs[] }`), so you assigned programs per secret. Now a secret is just an identity + the env var it exports (`{ name, envVar }`), and a **process** is a binary that names which secrets it receives (`{ name, requestedSecrets[] }`) — the same multi-select model automations already use for `requestedSecrets`. The shim generator now reads processes directly (no inversion): one shim per process, baking each requested secret's `envVar` from the store.

  **Cascade parity (the automations path was missing this):** deleting a secret now strips its name from every automation's and process's `requestedSecrets`, regenerates shims, and re-broadcasts automations — so no container keeps a dangling name a run/shim would silently skip. `removeSecretFromAll` was added to both `AutomationStore` and `ProcessStore`.

  **One-time in-place migration:** a v1 `secrets.json` (with `programs`) is rewritten to v2 (stripped) plus a new `processes.json` built by inverting `programs` — a program listed by several secrets becomes one process requesting all of them. Runs once at startup before the stores load; idempotent; invalid program names are dropped with a warning so it never writes an un-loadable file. No backwards compatibility is kept — the stores only know the new shapes.

  **REST surface:** `GET/PUT/DELETE /api/processes/:name` (`PUT` body `{ requestedSecrets }`, rejects unknown names with `invalid_secret`); secrets routes dropped `programs`. **CLI:** `localterm process list|set <name> [-s a,b]|delete`, and `localterm secret set` lost `-p/--programs` (use `process set` to wire binaries). **UI:** the secrets modal gains a Processes tab (Secrets ⇄ Processes, the automations tab pattern) with the same `SecretSelector` multi-select; the standalone processes menu entry is gone. Secret and process names are now immutable (a rename would silently disconnect cascade wiring — delete and recreate to rename); `envVar` stays editable.

  Also fixes the secrets modal showing only one row on first open: it used a fragile `scrollHeight - getTotalSize()` measurement that under-sized the body before rows measured. Dropped for the worktrees pattern (list div sized directly from `getTotalSize()`).

### Patch Changes

- Updated dependencies [727c493]
  - @monotykamary/localterm-server@2.27.0

## 2.26.1

### Patch Changes

- 04f28f6: Add the secrets modal to the command palette and fix Escape closing it.

  The secrets modal was the only overlay missing a command-palette entry — the toolbar's Secrets button already opened it, but ⌘/Ctrl+K → "Secrets" didn't. The palette now lists a "Secrets" action (Key icon, no shortcut) that opens the modal through the same `handleSecretsOpenChange` handler sessions/ports/worktrees/automations/QR use, so opening it dismisses the actions menu and command palette and closing it hides the toolbar and refocuses the terminal.

  Escape also now actually closes the secrets modal. Its keydown listener ran on the bubble phase with no `preventDefault`/`stopPropagation`, so the terminal's own Escape handler swallowed the key before it reached `window`. The handler now mirrors every other modal — capture phase, `preventDefault` + `stopPropagation`, `mounted`-gated — while keeping the form-cancel-first behavior (Escape drops an open edit form back to the list instead of closing the modal), which the footer hint already advertised.

  - @monotykamary/localterm-server@2.26.1

## 2.26.0

### Minor Changes

- b967c44: Let an automation request exactly the secrets it needs, resolved into the run's PTY env at spawn — never over HTTP.

  Automations type an arbitrary shell `command` into a tab, so a secret in that tab's env can be exfiltrated. Exposure is now **per-automation, opt-in, and least-privilege**: each automation carries a `requestedSecrets: string[]` (secret **names**, the stable identifier — not env vars) and defaults to `[]`, so an automation gets exactly the secrets it named and nothing else. A command alone can never reach a key the automation didn't explicitly request; the request list is a second, visible, auditable gate on top of the command.

  Resolution happens at **launch time**, not claim time: when a run fires (schedule / watch / event / webhook / manual), the daemon resolves each named secret from the Keychain in parallel and stores the env on the pending run _before_ it opens the run tab. The WS that claims the run is therefore guaranteed to see the resolved env, and the synchronous `onOpen` spawn path just passes it through to the PTY. Resolution is fail-closed on both ends: unknown names are rejected at create/update with `400 {"error":"invalid_secret"}` (catches typos), and a name deleted after the automation was authored — or a secret with no value (locked Keychain / never set) — is silently skipped at run time rather than clobbering a pre-existing env var with an empty string.

  The "values never cross the HTTP surface" property is unchanged: the value goes Keychain → daemon → PTY env, so the network-origin gate on `/api/*` is not widened. The env lives only in the run's shell process (and its children, e.g. `node scripts/update-models.js`), not the parent daemon or any other tab. The secrets store, schema, REST, and secrets modal are untouched — the field lives entirely on the automation.

  The automations file is forward-compatible: `requestedSecrets` defaults to `[]` in the stored shape, so existing v3 files load unchanged and v1/v2 migrations synthesize `[]`. The terminal's automations modal gains a "Secrets to expose" section (one switch per secret, with its env var) so you select per-automation from the secrets you've already configured; the create/update REST input schemas accept the field and the wire response carries it via the existing `automationWithNextRunSchema` spread.

- 104d61c: Align the secrets modal with the sessions/worktrees/automations modals by virtualizing the secret rows with `useVirtualizer`, so many secrets no longer render every row at once. The intro, unsupported banner, inline form, and empty state stay in the scroll area (only rows are virtualized), and the height-reserved open transition is preserved by computing the body height as the measured static content plus the virtualizer total.

### Patch Changes

- Updated dependencies [b967c44]
  - @monotykamary/localterm-server@2.26.0

## 2.25.1

### Patch Changes

- Updated dependencies [6d8102e]
- Updated dependencies [9f6135e]
  - @monotykamary/localterm-server@2.25.1

## 2.25.0

### Minor Changes

- 39a60f1: Add a per-program secret manager (Settings → Secrets) that stores API keys in the macOS Keychain and injects them only into the programs you list, via PATH shims — so `ls` in the same tab never sees your `ANTHROPIC_API_KEY`.

  The motivation is the agentic-coding pattern of pasting API keys into `~/.zshrc` (or a sourced `~/.tune/.env`) in plaintext, where every shell — and every file-reading AI agent — gets every key. localterm now owns this itself: a modal (Settings → Secrets) manages a policy of `{ name, envVar, programs }` entries (names only — values never leave the Keychain and never return to the browser after you save). The daemon generates a self-contained POSIX shim per program in `~/.localterm/shims` that resolves the secret(s) and `exec`s the real binary, and localterm's zsh/bash shell hook prepends the shims dir to `PATH` **after** the user's rc files run — so the shims reliably shadow the real binaries despite rc PATH manipulation (`export PATH=/opt/homebrew/bin:$PATH`), the failure mode of a naive daemon-time PATH entry. The secret exists only in the shimmed program's process (per-process scoping), not the parent shell, matching the "which programs have access" model.

  Values are never served over the daemon's HTTP `/api/*` surface: that surface is gated by a network-origin check (loopback/tailnet), not a capability check, so a `GET /api/secrets/:name` returning a value would be readable by any local process via `curl`. Instead, value resolution happens only in the shim at exec time, via the macOS `security` CLI (the same path the existing GitHub-token resolver uses). The HTTP routes carry names + the policy + a `hasValue` flag (probed from the Keychain without reading the value into memory) — enough for the UI to manage secrets without ever exposing them. Writes use `security add-generic-password -w <value>`, which passes the value as a CLI arg briefly visible to `ps` for the ~ms the `security` process lives — the standard `security`-CLI trade-off (it has no stdin path for the password); the value never touches disk.

  The backend is an interface (`SecretBackend`), so the macOS Keychain implementation can be swapped for an encrypted-file backend (non-darwin, no Keychain) without touching the store, routes, or shim generator — the generator bakes the backend's resolution snippet into each shim. Only the Keychain backend ships in this release; the daemon reports `supported: false` and the UI shows a banner on platforms without it.

  Secrets are also manageable from the terminal via `localterm secret list|get|set|delete`. `get` resolves the value from the Keychain directly (not through the daemon's HTTP API — preserving the "values never cross the network" property, and working with the daemon down), while `list`/`set`/`delete` go through the daemon's REST API. `set -v -` reads the value from stdin for the no-argv-exposure path. A `secrets-sessions.md` reference documents both the secrets and sessions REST surfaces (including the security model and the shim mechanism) and is linked from the `localterm` skill.

### Patch Changes

- Updated dependencies [39a60f1]
- Updated dependencies
  - @monotykamary/localterm-server@2.25.0

## 2.24.0

### Minor Changes

- 983dd6c: Add a "Default directory" setting (Settings → Launch) that seeds the working directory for shells launched without an explicit path.

  A bare launch — the PWA app icon, a fresh tab opened before any session connects, or a reloaded URL with no `?cwd=` — previously always spawned in the home directory, because the manifest pins `start_url: "/"` and the client only forwarded a cwd when the address bar carried one. The new setting persists to `localStorage` (key `localterm:default-cwd`) and is injected as a fallback in the WebSocket/new-tab URL builders, so the saved directory is used whenever no explicit `?cwd=` is present. The address-bar `?cwd=` and the live session's directory still take precedence, so in-session `cd`, reloads, and new tabs behave exactly as before; only param-less cold launches change.

  Stays client-side to match every other SettingsMenu row (synchronous, cross-tab via the `storage` event). The server is unchanged: it still validates `?cwd=` as a directory and falls back to the home directory if the path is missing, invalid, or deleted, so a stale saved default degrades gracefully. Emptying the field clears the default and restores home-directory launches.

### Patch Changes

- Updated dependencies [7ed7675]
  - @monotykamary/localterm-server@2.24.0

## 2.23.1

### Patch Changes

- 037f5a2: Collapse the mobile action menu whenever a sub-surface opens (sessions,
  worktrees, ports, automations, QR, command palette, find, diff viewer) so the
  expanded toolbar no longer lingers over the terminal after a session switch or
  modal launch. The menu now dismisses on a tap outside itself instead of a
  dedicated overlay layer, and the diff/PR indicators open the diff viewer
  directly rather than doubling as the toolbar toggle. Adds light tap haptics on
  the toolbar toggle and session switch.
  - @monotykamary/localterm-server@2.23.1

## 2.23.0

### Minor Changes

- 650df5c: Add a ⌘/Ctrl+Shift+D keyboard shortcut to open the dev-ports modal, with the matching `⌘⇧D` / `Ctrl+Shift+D` hint surfaced in the command palette's "Dev ports" entry (previously the only action entry without a shortcut hint).

  The dev-ports modal shipped without a dedicated shortcut because every plain modifier-letter is already claimed — ⌘K/J/B/G/F/I and ⌘\ are localterm, the rest collide with the browser. The shortcut is a Shift-variant, mirroring the ⌘Shift+B create-worktree precedent: Shift+D reads as "dev ports". Shift+P was the stronger mnemonic but is taken by Dia, and Shift+I is DevTools, so Shift+D is the cleanest free letter in Chromium. The shortcut toggles — press it with the terminal focused to open; Escape closes via the modal's own handler.

### Patch Changes

- @monotykamary/localterm-server@2.23.0

## 2.22.0

### Minor Changes

- Add an open dev-ports modal that shows the TCP listening sockets a session's shell has open (a dev server run inside a tab) and lets you stop one without leaving the terminal.

  Server side, two new routes. `GET /ports` walks the process tree under each session shell (`ps`) and the listening socket table (`lsof -nP -iTCP -sTCP:LISTEN`), then returns the ports that descend from a live session — each row carries the owning pid/process name and the session's id/title/cwd so the modal can badge it without a second fetch. `DELETE /ports/:pid` stops a dev server by `SIGTERM`-ing the owning pid; it re-verifies the pid still descends from a live session against a fresh snapshot before signalling, so a pid recycled after the dev server exited (the shell spawned an unrelated process that reused the number) can't be killed by a stale request. Both snapshots are injectable via `ServerOptions` (`portsSnapshotProcesses` / `portsSnapshotListeners`) so tests can drive the list deterministically without a real listener; the tree snapshot defaults to the same shared `ps` read keep-awake's automatic mode uses.

  Terminal side, a `PortsButton` in the toolbar and a `PortsModal` that polls the list while open (so a server starting/stopping shows up live). Each row is the port number (bold mono) as the identity, the owning session's title/path taking the flex-1 truncation slack, the process name + bind address right-aligned in a mono meta column (hidden on mobile so the row stays a one-liner on a phone), and an always-visible stop button trailing. The row itself is informational — stopping a dev server is an explicit, deliberate action via the stop button (or Enter on the highlighted row) so an accidental tap never kills a running server. The stop button is always shown, not hover-gated like the sessions modal's kill X, because a touch device has no hover to reveal it and stopping a dev server is this modal's whole purpose. Wired into the command palette as "Dev ports" with a Network icon.

### Patch Changes

- Make the floating toolbar overlay horizontally scrollable on touch devices so its action buttons stop clipping on narrow phone widths.

  The toolbar capped its width at `100dvw-1.5rem` and gave its inner collapsing grid `min-w-0`, so on a phone the row shrank and the non-shrinking buttons overflowed off-screen and were cut off. On touch devices the toolbar now scrolls instead of clipping (`overflow-x-auto` with a hidden scrollbar), and the inner grid switches to `shrink-0` so the buttons keep their natural width and the row scrolls past them rather than squeezing them out. Non-touch behavior is unchanged.

- Updated dependencies
- Updated dependencies
  - @monotykamary/localterm-server@2.22.0

## 2.21.0

### Minor Changes

- df96a6c: Add a "New shell" button to the sessions modal footer so the new-tab action — removed from the toolbar when it was replaced by the QR button — stays reachable from inside the session switcher. The button opens a new browser tab to the current working directory's shell URL via the same `window.open` path the "Shell ended" dialog uses, then runs the modal's close path (toolbar-hover cleanup + terminal refocus).

  On touch devices the footer's keyboard hints (`↑↓` / `↵` / `esc`) are hidden — they're dead weight without a keyboard — so the button becomes the sole footer affordance there. The hidden `#new-shell-link` anchor, the `Alt+T`/`⌘T` shortcut, and the command-palette "Open new shell" entry are untouched.

### Patch Changes

- @monotykamary/localterm-server@2.21.0

## 2.20.2

### Patch Changes

- Updated dependencies [16f28b7]
  - @monotykamary/localterm-server@2.20.2

## 2.20.1

### Patch Changes

- Fix predictive typing so it actually engages, and stop it desyncing after cursor moves.

  The predictor shipped in 2.20.0 never activated for a typed burst: `lastInputMs` initialized to 0 so the first keystroke of a session wasn't a burst-start probe, and with RTT unknown every subsequent keystroke skipped — the feature was inert for normal fast typing. Initialize `lastInputMs` to the distant past so the first keystroke probes, and predict the rest of the burst optimistically while the probe's echo is in flight (the RTT gate still wins for spaced typing once the link is measured fast).

  A cursor-moving control (arrow, backspace, Ctrl-U, Enter) leaves xterm's cursor out of sync with the shell's logical cursor until its echo arrives, so a char typed immediately after one would render at the wrong column for ~RTT. Add a `suspended` flag: controls suspend prediction; the control's echo resyncs the geometry and clears the suspension.

  Add a model-based test harness that runs the real `LocalEcho` over a fake-timer link against a golden-model terminal and a simulated cooked-mode shell, then diffs the screen against the shell's ground truth. 12 scenarios cover plain / chunked / syntax-highlighting echo, backspace (end + mid-line), mid-line insert, Ctrl-U, the `read -s` password leak + watchdog, the RTT gate for spaced typing, and the disabled / TUI gates.

  - @monotykamary/localterm-server@2.20.1

## 2.20.0

### Minor Changes

- 8184d89: Add client-side predictive typing so keystrokes feel instant on high-latency links (a tailnet over a DERP relay, a phone on cellular) without changing the local surface.

  Each printable keystroke is written to xterm.js immediately in a faint "unconfirmed" style; the server's real echo overwrites it in normal intensity when it arrives — the mosh model, on top of xterm.js. A self-measured round-trip gate keeps prediction off on fast links (no per-keystroke flash) and turns it on only when latency exceeds ~50ms, so the common local / direct-tailnet path is unchanged. Reconciliation is a streaming prefix match with a cursor-forward fixup so chunked echoes don't desync, and a mismatch (a syntax-highlighting shell that reprints the line) erases the dim span and defers to the real output.

  Safety: prediction runs only at the shell prompt in the normal buffer (no foreground program, not the alt screen) — the same state localterm already classifies for the grey "ready" favicon — so TUIs and raw-mode programs are excluded by construction. A watchdog erases any unconfirmed prediction after 1s + a cooldown, so a misdetected no-echo prompt (a password) can never leave typed text visible. Toggled via Settings → Typing → Predictive typing (on by default). Server unchanged: the prediction is a client-side render illusion; the real keystroke still travels the wire.

### Patch Changes

- @monotykamary/localterm-server@2.20.0

## 2.19.0

### Minor Changes

- db3f472: Add a QR session-transfer modal to the terminal toolbar for handing a live shell between devices. The toolbar's new-tab button (`+`) is replaced by a QR icon — the `Alt+T`/`⌘T` new-tab shortcut and the command-palette "Open new shell" entry still work via a kept-but-hidden anchor — that opens a modal with a Share/Ingest switcher.

  Share renders a QR of the current tab's session URL (`<origin>/?sid=<id>`) for the localterm PWA on another device to scan and reattach to the same shell; a copy-link button mirrors the URL for manual sharing. Ingest opens the device camera, decodes another device's session QR with jsQR, extracts the `sid`, and switches this tab to that session via the existing session-switch path. Non-session QRs are ignored so scanning keeps hunting, and the camera stream stops the instant the modal closes or switches back to Share.

  Dependencies: qrcode.react (QR rendering) and jsqr (camera-frame decoding), both browser-only.

### Patch Changes

- @monotykamary/localterm-server@2.19.0

## 2.18.0

### Minor Changes

- f41f937: Make localterm a fully installable PWA with a maskable icon and an offline service worker.

  The manifest previously held a single data-URI SVG icon and no service worker, so "Add to Home Screen" produced a Chrome-badged shortcut rather than an installable app. The manifest now references file-based icons — an SVG plus 192/512 PNGs declared `purpose: "any maskable"` — generated from a single `icon.svg` source via `pnpm generate:icons` (sharp). The full-bleed `#f4f4f5` background with a centered emerald `>_` sits inside the maskable safe zone with ~2.4 units of margin, so circular/squircle Android launchers apply their own shape and drop the Chrome badge, and iOS gets a clean `apple-touch-icon`.

  A build-time service worker (`scripts/generate-sw.mjs` from `sw-template.js`, run as the last `build` step) precaches the app shell, all font subsets, the icons, and the manifest under a content-hashed version, serves navigations network-first with the cached shell as the offline fallback, bypasses `/api` and `/ws`, and purges stale caches on activation. Registered from the terminal only in production builds.

  The manifest gains `id`, `lang`, `dir`, `categories`, and `launch_handler` (reuse existing window on relaunch), and `index.html` gains `apple-touch-icon`, `mobile-web-app-capable`, `apple-mobile-web-app-title`, and `application-name`. The app root is padded with `env(safe-area-inset-*)` so the terminal and toolbar clear phone notches and the home-indicator bar in standalone mode.

  Server: the static resolver now serves `.webmanifest` as `application/manifest+json` (it was `application/octet-stream`, which strict browsers reject) and sends `cache-control: no-cache` for `/sw.js` and `/manifest.webmanifest` so a new build is detected promptly.

### Patch Changes

- faff5ca: Fix the blank git ambient overlay on mobile and two mobile layout overflows in the diff viewer and automations modal.

  The ambient git-diff/PR overlay sometimes stayed blank on mobile while pi made changes, only recovering after a session switch back and forth. The per-cwd `GitDirtyCoordinator` only pushed a `git-diff-summary` when a `git-dirty` signal fired _after_ a client subscribed — there was no initial push on attach. So a freshly-attached tab (page load, reconnect, or a reattach whose fan-out already completed) never learned the current summary until the next `git-dirty` signal; on a flaky DERP-relayed link the user saw a blank overlay until a session switch's resize/prompt-redraw fired a `git-dirty`. The coordinator now caches the last computed summary and replays it to a new subscriber on `add` (the first subscriber with no cached summary triggers a fresh compute). The replay reuses the cache instead of invalidating, so a reattach no longer thrashes the diff viewer's per-file patch cache.

  The automations modal's collapsed sidebar row kept the sort buttons (last-run / created / name) next to the select when the screen narrowed, but they don't fit on a phone. The row now drops them when collapsed — the select stays (and grows to fill the row, truncating long names) — and the sort/search controls remain available in the expanded sidebar. The select popover keeps its own search.

  The diff viewer's selected-file row didn't truncate the file path: the path container lacked `min-w-0`, so a flex item wouldn't shrink below its content and `truncate` never engaged — long paths overflowed and pushed the external-link button and the +/- stats off-screen, and when truncation did engage it cut the tail (the basename) and showed the head. The path container now shrinks (`min-w-0 flex-1`) and the path is tail-truncated using the same `dir="rtl"` + `<bdi>` split the file-list popover already uses: the directory renders muted and the basename in the foreground, and when it overflows the head (directory) is cut with an ellipsis so the tail (basename) always stays visible. The dropdown trigger mirrors the popover rows (muted directory + foreground basename), and the rename display keeps the new path's tail visible. Tail-truncation is done in CSS (the browser's own layout engine, pixel-accurate against the user's chosen mono font) rather than measured with pretext, whose hardcoded font string wouldn't match a custom font.

- 3eb93e0: Fix the blank-screen-on-refresh mobile regression and route automation run tabs at the daemon-local surface.

  A freshly-attached WS client stays "pending" for `SESSION_PENDING_PROMOTE_TIMEOUT_MS` until it sends `{ready, replay}`, then the server flushes its scrollback replay + buffered output. The timeout was 100ms — shorter than a mobile/tailscale round-trip (often DERP-relayed at 200–400ms). The auto-promote fired before the client's `{ready, replay: true}` arrived, and since the auto-promote skips the scrollback it never sent the `replay-end` the client had already opened its suppressed-replay window for — so every output frame buffered client-side in `replayChunks` and never rendered, leaving a blank screen with a blinking cursor only a session-picker switch could recover. The timeout now clears a flaky relayed tailnet with room to spare (2s), and `promote` always sends `replay-end` (even on `replay: false`) so a slow link can never deadlock the client in its replay window. The timeout is injectable for tests.

  Automation run tabs opened at the announced `publicUrl`, which `resolveDaemonUrl` picks tailnet-first — so a tailnet-fronted daemon opened run tabs at `https://<node>.ts.net`. Run tabs open in the daemon's own debugged browser, where a flapping `tailscale serve` (laptop wake, DERP relay, cert renewal) fails the tab load, the PTY never spawns, and the automation fails. The CLI now resolves a separate daemon-local `localUrl` (portless `https://localterm.localhost`, else loopback) and hands it to the server via a new `localUrl` option / `RunningServer.setLocalUrl`; `tryLaunch` opens run tabs at the local surface, and `isLocaltermTabUrl` recognises it so ambient-token injection and `closeOnFinish` keep working on the portless run-tab URL. The remote `publicUrl` (tailnet) still drives the network-policy host allowlist and `--open`, so a tailnet-fronted daemon still serves mobile on the tailnet URL — run tabs just never ride it. `ensurePortlessRoute` now always runs (in parallel with the tailscale probe) so the portless alias is re-registered for the current bound port even when tailnet fronts the daemon.

- 8423e48: Keep the installed PWA portrait so it honors a portrait rotation lock.

  The Web App Manifest's `orientation` member is an app-level policy with no
  value meaning "follow the system rotation lock." The default (`"any"`,
  applied whether the field is omitted or set explicitly) makes an installed
  PWA (WebAPK) on Android rotate with the sensor and ignore the lock — which
  is why localterm kept rotating despite a portrait lock. Setting
  `orientation: "portrait"` constrains the WebAPK activity to portrait,
  matching a portrait lock. This hardcodes portrait (it won't follow a
  future landscape lock or allow landscape auto-rotate); for a terminal,
  portrait is the conventional orientation. WebAPKs bake the manifest in at
  install time, so remove the home-screen icon and re-add it after rebuilding
  for the change to take effect.

- Updated dependencies [faff5ca]
- Updated dependencies [3eb93e0]
- Updated dependencies [f41f937]
  - @monotykamary/localterm-server@2.18.0

## 2.17.3

### Patch Changes

- Mobile touch + on-screen-keyboard UX fixes: stop glide-scroll from
  popping the keyboard (inputmode="none" guard + visualViewport
  keyboard-hide detection), strip autofill strips from search inputs,
  make menus scroll on mobile, and add coarse-pointer detection.
  - @monotykamary/localterm-server@2.17.3

## 2.17.2

### Patch Changes

- Updated dependencies [4ac3ea0]
  - @monotykamary/localterm-server@2.17.2

## 2.17.1

### Patch Changes

- Updated dependencies [1326d81]
- Updated dependencies [1ff7c56]
  - @monotykamary/localterm-server@2.17.1

## 2.17.0

### Minor Changes

- Surface the CDP background-tab path (no focus steal, closeable automation run tabs) across the first-time install UX so a user can tell whether it's on and how to enable it:

  - `/api/health` reports the daemon's persistent CDP socket state as a `cdp` field (`{ connected, browser? } | null`).
  - `localterm start` prints a `cdp:` line — background tabs via the detected browser, or the OS opener with a pointer to `localterm install`.
  - `localterm status` prints the CDP mode (background + closeable via CDP / OS opener / disabled).
  - `localterm install` runs a CDP probe step alongside the portless and tailscale checks, with the `--remote-debugging-port=9222` hint.
  - The automations modal locks `Close tab when finished` off with an amber warning when no debug-enabled Chromium is connected, instead of letting the setting save as a silent no-op.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.17.0

## 2.16.5

### Patch Changes

- 8ca96fb: Drop the `[connection lost · code X]` and `[reconnected]` text the client wrote into the xterm buffer around a PTY reconnect. With daemon-side multiplexing the PTY survives transient WebSocket drops and the client silently reattaches, so on every wake/blip these markers were injected into the live shell output — corrupting the screen mid-keystroke for no informational value. The connection-lost modal and the `disconnected · code N` status badge already surface a genuine daemon-down failure (the only case where the lost-connection text carried meaning), so the in-buffer markers were redundant noise. Also drops the now-unused `format-connection-lost-marker`, `format-reconnected-marker`, and `format-cursor-reset-sequence` helpers and the dead missed-reattach branch in the session-frame handler.
  - @monotykamary/localterm-server@2.16.5

## 2.16.4

### Patch Changes

- 477472d: Columnize the session-list row metadata so a changing age no longer shifts the surrounding text across rows. The shell/pid/age detail was a single text span, so the age — the only piece that changes over time (`5m ago` → `59m ago` → `1h ago`) — moved the whole block, and since each row has a different age every row's text sat at a different x. Split it into right-anchored columns: the age gets its own fixed right-aligned column flush to the action slot, so a longer/shorter age only slides within that column and never drags the shell name, pid, or status pill; the pid is its own right-aligned column; the shell name stays content-width so it still hugs the pill and grows leftward for long names. Drop the `·` separators (right-aligning values inside fixed columns left a gap after each dot) and use the column gap instead, so the slack reads as spacing rather than a broken separator. The whole meta group stays right-justified against the action, and the title's flex-1 truncation absorbs the remaining slack on the left.
  - @monotykamary/localterm-server@2.16.4

## 2.16.3

### Patch Changes

- 971bcf1: Reattach the live PTY on a tab refresh instead of spawning a fresh shell. The server already supported `?sid=` reattach (used by the session switcher and transient WS drops), but the client kept the session id only in memory and never wrote it to the URL — so a full page refresh (⌘R / F5) wiped it, opened a no-`sid` WebSocket, and the daemon spawned a new shell while the old PTY detached, sat dormant for the grace window, and got reaped. The session id is now mirrored into the address bar as `?sid=` (alongside the existing `?cwd=`) when a session frame lands, cleared on shell exit, and `buildWebSocketUrl` falls back to it on a fresh page load. The attach handshake also requests a scrollback replay when the surface is blank on a fresh load (`priorSessionId === null`), so a refresh onto a live PTY lands on its recent output instead of a blank screen — a no-op for a brand-new spawn, whose ring buffer is empty.
- 971bcf1: Drop the redundant "leave site?" beforeunload guard. The prompt fired on tab close while a foreground program was running (vim, a build) to keep the user from killing the PTY. With daemon-side PTY multiplexing, closing a tab now detaches instead of killing — the shell survives the no-clients grace window and any tab can reattach from the session switcher (and, after the refresh-reattach change, via `?sid=` on reload). The guard's only remaining effect was an annoying confirmation dialog for a close that's no longer destructive, so it's removed along with the `onModalOpenChange`/`onForegroundProcessChange` props on `Terminal` that existed solely to feed it.
- Updated dependencies [0aef8a5]
  - @monotykamary/localterm-server@2.16.3

## 2.16.2

### Patch Changes

- Restore the current/active/orphaned attachment pills in the session list, alongside the activity-colored terminal icon. The pill says who's viewing (current/active/orphaned); the icon color says what the shell is doing (running/quiet/idle).
- Updated dependencies
  - @monotykamary/localterm-server@2.16.2

## 2.16.1

### Patch Changes

- Keep active dormant PTYs alive and color sessions by activity. A dormant shell (no attached clients) that's still producing output — a build, a long command — is no longer reaped mid-stream: the grace timer re-checks on fire and reschedules while output is recent, so only a truly idle shell (quiet long enough that the tab favicon would be grey) is reaped. This is the same output-recency signal the client's favicon uses, now driving both the session-list row color and the reap decision. Each row's terminal icon is colored by a favicon-equivalent state (running / alive-quiet / ready), computed server-side and added to the session-list schema.
- Updated dependencies
  - @monotykamary/localterm-server@2.16.1

## 2.16.0

### Minor Changes

- ea27ef3: Add true PTY multiplexing: a shell now outlives the tab that spawned it, and any tab can switch to it from the session switcher.

  Closing a tab detaches instead of killing — the shell waits (dormant) for a 30s grace window, then is reaped if no tab reattaches. One authority spawns a shell; others join alongside via the switcher. This replaces the prior 30s `SessionReattachPool` grace (same-tab-only) with a daemon-wide `SessionManager` that owns every live PTY, supports any number of attached clients per PTY (output/title/cwd/foreground/exit fan out to all of them), tmux-style min(cols)/min(rows) resize across clients, OS-pipe backpressure that pauses the PTY when any client falls behind, and a continuous per-session scrollback ring buffer replayed on attach so a switching tab lands on recent output instead of a blank screen.

  New surface: `GET /api/sessions` (list live PTYs), `DELETE /api/sessions/:id` (kill). The WS gains a `{type:"ready", replay}` handshake — the localterm client sends it after the session frame so the scrollback replay lands before live fan-out on a switch; a back-compat client that never sends it (and never sends input) is auto-promoted after a 100ms window with its buffered output flushed, so no output is ever lost and older clients keep working. `?sid=` now attaches to any live PTY by id, not just the same-tab parked one.

  The terminal app adds a sessions modal in the top-right toolbar (SquareTerminal icon, `⌘`/`Ctrl+I`), styled as a command-palette overlay with search, virtualized rows, keyboard navigation, and active/orphaned status pills. The command palette gains a "Sessions" entry. `SessionRegistry` + `SessionReattachPool` are replaced by `SessionManager` (+ extracted `GitDirtyCoordinator` and `utils/ws-socket`).

### Patch Changes

- Updated dependencies [ea27ef3]
  - @monotykamary/localterm-server@2.16.0

## 2.15.3

### Patch Changes

- 5ce5186: Fix the trailing-glyph clip in joined ligature runs. A terminal font's last glyph in a joined run can overhang its cell advance by more than the renderer's flat 3-device-px trailing budget (notably Fira Code's capital F arm in `0xDEADBEEF`, `0xCAFE`), so the atlas sized both the temp raster and the ink-bounding scan short of the true ink and the tail was cut off. The WebGL addon patch now adds a `deviceCellWidth`-scaled trailing overhang budget so the canvas and scan capture the full ink at any font size, while the bounding-box trim keeps the textured quad tight.
  - @monotykamary/localterm-server@2.15.3

## 2.15.2

### Patch Changes

- 57c1e46: Bump devDependencies: @types/node 26.0.0 → 26.0.1, turbo 2.9.18 → 2.10.0, portless 0.14.0 → 0.15.0.
- Updated dependencies [57c1e46]
  - @monotykamary/localterm-server@2.15.2

## 2.15.1

### Patch Changes

- Restore the diff viewer open-file button's screen-reader-friendly aria-label ordering ("open <path> in neovim" for text, "open image <path>" for images), which the image-preview feature had flattened and which left two diff-viewer tests red on main.
  - @monotykamary/localterm-server@2.15.1

## 2.15.0

### Minor Changes

- Add a "Ligatures" toggle to the terminal settings that fuses multi-character operators (->, =>, ===, !==, ...) into single glyphs via xterm's character-joiner API, with full Fira Code v6 parity: composable arrows and markdown rules of any length (-->, ====>, ---, ===), the letter pairs (fi, fj, Fl, Il, Tl, www), and hex/dimension literals (0xFF, 0xDEADBEEF, 1920x1080). A no-op on fonts without ligatures, so the toggle is safe across the whole font list.

### Patch Changes

- @monotykamary/localterm-server@2.15.0

## 2.14.0

### Patch Changes

- Updated dependencies [75932da]
  - @monotykamary/localterm-server@2.14.0

## 2.13.3

### Patch Changes

- 155fa79: Stop `localterm install` crying wolf about `portless service install` when the proxy is already running.

  `setupPortlessProxy` ran `portless service install` unconditionally, and that subcommand fails spuriously on machines where the proxy is already installed (it shells out to BSD `install` and dumps its usage banner), so every `localterm install` printed `⚠ portless service failed: Command failed: portless service install` even though `:443` was healthy. It now treats a live proxy as the source of truth: when `isProxyLive` (`:443`) is already true it skips the install and reports `✔ proxy already running`; otherwise it attempts the install and re-checks liveness before warning, so a genuine "proxy not running" still surfaces but the existing-install false-failure stays silent.

  - @monotykamary/localterm-server@2.13.3

## 2.13.2

### Patch Changes

- 8ca4be4: Cut the per-PTY syspolicyd spike and restore the portless surface for automation run tabs.

  The launchd-managed daemon spiked syspolicyd to ~30% on every PTY open because the plist baked the full user `PATH` (added in 2.12.0 so the daemon could find `portless`), which leaked into the PTY login shell and the daemon's own `git`. A launchd agent has no GUI provenance, so the ad-hoc Homebrew binaries that mise/direnv bootstrapped (`direnv`, `git`) were re-assessed by syspolicyd per prompt — ~207 violates / 621 SecKeyVerify per PTY, never cached. Pre-2.12.0 the plist set only `HOME`, so the daemon ran on launchd's minimal `/usr/bin:/bin` and the spike was ~3/9.

  Three changes restore the pre-portless behaviour without losing the portless surface:

  - The plist now bakes a minimal system PATH plus the daemon's own `node` dir and `portless` dir (captured at `localterm install`). The daemon still finds `portless` (named `.localhost` URLs) and `node`, but no longer pulls Homebrew/mise onto its PATH. User shells bootstrap their own tools via rc files like any login shell, and now resolve the correct mise-managed `node` instead of Homebrew's. `LOCALTERM_PTY_FULL_PATH=1` opts back into the old leaky behaviour.
  - The daemon's `git` (diff summaries, repo detection on every PTY) now resolves to `/usr/bin/git` (Apple-signed, cached regardless of provenance) when it's a real git, falling back to PATH-resolved `git` where `/usr/bin/git` is only the Xcode shim.
  - `isProxyLive` (the portless liveness probe) now checks both `127.0.0.1` and `::1` on `:443`. portless's network extension serves loopback on IPv6, so the old IPv4-only probe timed out and the daemon fell back to the loopback URL even when portless was healthy — automation run tabs opened at `http://localterm.localhost:<port>` instead of `https://localterm.localhost`. Re-run `localterm install` to rewrite the plist, then restart.

  Also fixes a pre-existing parse error in `automations-api.test.ts` (a stray `"` where a backtick was meant left a template literal unclosed), which had prevented the "automation run tab surface" suite from running since 2.13.0.

- Updated dependencies [8ca4be4]
  - @monotykamary/localterm-server@2.13.2

## 2.13.1

### Patch Changes

- 1e27858: Open automation-run tabs at the announced surface instead of the loopback URL.

  Automation runs always opened at the hardcoded `http://localterm.localhost:<port>` loopback URL even when portless (or Tailscale) fronted the daemon, so a scheduled run landed on the http tab instead of `https://localterm.localhost`. The CLI now hands the daemon the surface it resolved (best-first: tailnet → portless → loopback) through a new `publicUrl` server option / `setPublicUrl` setter on `RunningServer`, and `tryLaunch` builds the run-tab URL from that origin. The CDP tab filter (`isLocaltermTabUrl`) also recognises the announced origin, so ambient-token injection and `closeOnFinish`'s CDP `closeTab` keep working behind the proxy — a portless URL carries no port and a tailnet URL is on `:443`, both of which the old `parsed.port === String(port)` check rejected.

  Separately, the launchd-managed daemon still resolved to loopback even with the above, because the generated plist set only `HOME` — no `PATH` — so the daemon (launched with launchd's minimal `/usr/bin:/bin`) couldn't find the `portless` binary and `resolveDaemonUrl` fell back to loopback with a "portless not installed" warning. `buildPlistContent` now bakes the install-time `PATH` into the plist's `EnvironmentVariables` (XML-escaped), so the daemon finds `portless` (and Homebrew `git`, mise shims, etc.) the same way a foreground `localterm start` does. Re-run `localterm install` to rewrite the plist with the PATH, then restart.

- Updated dependencies [1e27858]
  - @monotykamary/localterm-server@2.13.1

## 2.13.0

### Minor Changes

- 03728d7: Preview and open changed images in the diff viewer.

  The diff viewer's "open file" affordance now handles images, and a changed image
  renders inline in the diff pane instead of the generic "Binary file — no text
  diff to show." notice.

  - Selecting an image file (png/jpg/jpeg/gif/webp/avif/bmp/ico/svg) renders an
    inline `<img>` preview straight from the working tree, so a glance at the diff
    shows the actual pixels. A load failure (e.g. a deleted image whose file is
    gone) falls back to a notice rather than a lingering broken-image icon.
  - The header's ExternalLink button — previously hidden for every binary — now
    opens image files in a new browser tab, where Chrome renders them natively;
    text files still open in neovim via the existing PTY-tab path. Non-image
    binaries keep the old behavior (no button).
  - A new `GET /api/file?cwd=&path=` route on the daemon serves working-tree image
    bytes with a real `Content-Type` and `Content-Disposition: inline`. It is
    gated to image content types so it can never serve an arbitrary HTML/text file
    from the same origin (which would let a repo file XSS the terminal app). SVG
    responses carry a `default-src 'none'` CSP so an embedded `<script>` can't run
    even when the SVG is navigated to directly, and `cache-control: no-store`
    keeps the preview current after an in-place edit.
  - The image allowlist (`isImagePath`) is shared between server and client via the
    `protocol` subpath, so the route and the viewer agree on what counts as an
    image.
  - SVG is text (git reports `binary: false`), so SVGs keep their readable text
    diff AND gain the open-image button to view the rendered result; raster images
    are always binary, so they show the preview.

### Patch Changes

- Updated dependencies [03728d7]
  - @monotykamary/localterm-server@2.13.0

## 2.12.4

### Patch Changes

- Updated dependencies [3c28588]
  - @monotykamary/localterm-server@2.12.4

## 2.12.3

### Patch Changes

- Updated dependencies [a68cc2b]
  - @monotykamary/localterm-server@2.12.3

## 2.12.2

### Patch Changes

- Updated dependencies [55e8f66]
  - @monotykamary/localterm-server@2.12.2

## 2.12.1

### Patch Changes

- f44351f: Suppress connection-lost/reconnected markers on successful PTY reattach.

  With 2.12.0's `SessionReattachPool`, a transient WS drop (portless teardown on
  laptop wake, brief network blip) no longer kills the PTY — the server parks it
  behind a `sid` and a reconnecting client with `?sid=` reattaches to the same
  live shell. But the client was still unconditionally writing
  `[connection lost · code 1006]` on close and `[reconnected]` on the new WS
  open, because those markers predated the reattach pool and fired before the
  new session frame could confirm whether the PTY survived.

  This broke interactive CLIs mid-keystroke: a `vim` editing session would see
  both markers injected into the buffer on every wake, corrupting the screen
  state even though the underlying PTY was fine.

  Now the client defers the connection-lost marker/modal on a close that has a
  `liveSessionId` (shell might be parked server-side) and waits for the
  reconnect's `{type:"session"}` frame:

  - **Same `id` echoed back** → silent reattach succeeded. No markers, no modal.
    The screen stays exactly as the user left it; a mid-keystroke interactive
    CLI continues uninterrupted.
  - **Different `id`** → grace expired, server spawned a fresh shell. Write the
    deferred `[connection lost · code X]` marker honestly so the user can tell
    where the prior shell ended and the fresh prompt began. No modal — the
    user's already at a usable prompt and can keep working.
  - **Silent reconnect itself closes** (daemon genuinely down) → fall through to
    the existing connection-lost modal path with the stashed close info.

  The markers still surface honestly when reattach actually fails — the noise
  suppression is strictly for the case where the shell provably survived.

  - @monotykamary/localterm-server@2.12.1

## 2.12.0

### Minor Changes

- 97739c5: Detach PTY lifetime from the WS so a transient disconnect no longer kills the shell.

  Previously a WS close — anything from a portless teardown on laptop wake to a
  brief network blip — called `session.dispose()` in `onClose`, killing the PTY
  with the socket. A reconnecting client spawned a brand-new shell at the same
  cwd; the user's screen, in-flight command, and scrollback were gone. This was
  the actual root cause of the "terminals exiting on sleep" symptom the
  portless move surfaced: portless's WS proxy destroys both halves of its
  two-socket pipe on any side's `close`/`error`/`end` during wake, which
  appears to the daemon as an abrupt `code=1006 wasClean=false` — and the PTY
  died with it.

  Now a WS close parks the still-live Session behind a server-generated `sid`
  (included in the `{type:"session"}` message, forwarded back as `?sid=` by the
  client on reconnect) for a grace window. A fresh WS opening with the
  matching `?sid=` reattaches the live PTY: same pid, same shell, same
  scrollback from the page's perspective. The grace window (`SESSION_GRACE_MS`,
  30s) is the disposal trigger for genuinely abandoned sessions (tab closed,
  crash, network gone) — sized to cover the post-wake reconnect handshake
  (the PTY itself survives sleep, suspended with the OS; only the WS dies).

  This works for the portless-on-sleep case specifically because the PTY is a
  child of the daemon and freezes/resumes with it — only the proxy's TCP
  plumbing tears down on wake. The grace window bridges the ~1-2s between
  portless surfacing the close and the browser's reconnect landing.

  Park/claim/expire/exit semantics live in a new `SessionReattachPool`.
  misses (grace elapsed, shell exited while parked, unknown sid) all fall
  through to a fresh spawn — there is no failure mode where a `?sid=` reconnect
  gets rejected.

### Patch Changes

- Updated dependencies [97739c5]
  - @monotykamary/localterm-server@2.12.0

## 2.11.1

### Patch Changes

- Updated dependencies [202e623]
  - @monotykamary/localterm-server@2.11.1

## 2.11.0

### Minor Changes

- 35c273a: Open diff files in neovim from a new browser tab.

  The diff viewer's selected-file header gains an `ExternalLink` icon (reusing the
  worktrees "open in a new shell" glyph) next to the file name — and, when the
  sidebar collapses to a narrow file-list popover, next to that picker. Clicking it
  opens a fresh browser tab at the repo cwd with `nvim <path> && exit` injected as
  the initial command, so you land in neovim on the exact file, and `:q` returns
  to a shell that exits cleanly.

  - `&& exit` rides the existing clean-exit path: a zero exit drives
    `window.close()` / the CDP-driven `closeTab` (the same mechanism worktree
    setup scripts and `closeOnFinish` automations use), so the tab auto-closes on
    `:q`. A non-zero exit (file unreadable, `:cq`, nvim missing) skips the
    auto-close and surfaces the dead-session mask with the code, so failures
    aren't silently dropped.
  - The path is POSIX single-quote-escaped (embedded `'` via close-escape-reopen)
    so spaces, parens, `$`, backticks, and glob characters can't expand. Hidden
    for binary files, matching the existing `+`/`−` suppression.

### Patch Changes

- @monotykamary/localterm-server@2.11.0

## 2.10.1

### Patch Changes

- Updated dependencies [afcca5d]
  - @monotykamary/localterm-server@2.10.1

## 2.10.0

### Minor Changes

- Tailscale sharing + clearer URL surfacing.

  - `localterm install` now configures `tailscale serve --bg --https 443` so the
    daemon is reachable on your tailnet at `https://<node>.ts.net` (real
    Let's Encrypt cert, auto-managed by Tailscale). Falls back gracefully with
    actionable hints when tailscale is absent, HTTPS certs are disabled on the
    tailnet, or the node is offline. `localterm uninstall` tears the serve rule
    down.
  - `localterm start` / `restart` / `status` resolve the URL across three
    surfaces and announce the best one with a label (`tailnet` / `local` /
    `loopback`): tailscale serve → portless alias on `:443` → the RFC 6761
    named-with-port fallback.
  - Proxy liveness probe before announcing the portless URL: closes the dead-URL
    footgun where `pnpm run start` without `pnpm cli install` registered an
    alias that pointed at nothing.
  - `install` warns with install commands when portless or tailscale are missing,
    and links to the Tailscale HTTPS-certs admin toggle when certs aren't
    enabled, so contributors know exactly what to do.
  - Tailscale binary discovery probes well-known paths (macOS app,
    Homebrew `/usr/local` + `/opt/homebrew`, `/usr/bin`) so no PATH symlink is
    required.

### Patch Changes

- @monotykamary/localterm-server@2.10.0

## 2.9.0

### Minor Changes

- a880eb1: Integrate portless for stable named `.localhost` URLs.

  - `localterm install` now also sets up the portless proxy: installs the
    root-owned launchd service (HTTPS on `:443`, starts at boot) and trusts
    the local CA so browsers accept `https://*.localhost`. Both steps are
    best-effort and skipped when `portless` isn't on PATH, so installs
    without the workspace dependency are unaffected.
  - `localterm start` / `restart` register a static portless route
    (`https://localterm.localhost` → the bound port) after the daemon comes
    up, and announce that URL. When portless is absent they fall back to the
    named host with port (`http://localterm.localhost:<port>`), which still
    resolves via RFC 6761.
  - `localterm status` adds a `raw:` line for the literal loopback bind.
  - Adds `getDirectUrl` / `getPortlessUrl` helpers alongside `getFriendlyUrl`.
  - The terminal dev server runs through portless at
    `https://dev.localterm.localhost` (real `vp dev` moved to `dev:app`).
  - Requires Node 24+ in the workspace (portless runtime); the published CLI
    still declares `node >=22` since it doesn't bundle portless.

### Patch Changes

- @monotykamary/localterm-server@2.9.0

## 2.8.2

### Patch Changes

- ef9a827: Bump dev dependencies to latest: TypeScript 5.9 → 6.0, @types/node 25 → 26, vite-plus / @voidzero-dev/vite-plus-core 0.1 → 0.2. Removed `baseUrl` from the terminal tsconfigs, which TypeScript 6 now hard-errors on (TS5101).
- Updated dependencies [ef9a827]
  - @monotykamary/localterm-server@2.8.2

## 2.8.1

### Patch Changes

- Key the WebGL glyph atlas cache by font config so a stale heavy glyph can't be served after the config stabilizes.

  The intermittent emboldening was a stale atlas cache entry: the cache key omitted every font-config field, so a glyph baked under a transiently-wrong `_config` was cached forever under the normal key. Measured live via CDP on emboldened tabs — `term.options.fontWeight="normal"` + identical atlas config, but the baked 'M' had 154 bright / 40 mid pixels vs 96 / 86 on a normal tab, self-healing only on `clearTextureAtlas` / resize.

  Fold a hash of (`fontWeight`, `fontWeightBold`, `fontSize`, `devicePixelRatio`, `fontFamily`) into the cache key's unused second slot so the transient entry can't hit after recovery, guard the canvas font-string weights (`||"bold"`/`||"normal"`) so an undefined weight can never leave the canvas on a sticky-bold font, and reset the hash in `atlas.clearTexture`.

  - @monotykamary/localterm-server@2.8.1

## 2.8.0

### Patch Changes

- 83d1bbe: Pair each WS socket with its CDP target for reliable tab close on shell exit.

  Ctrl+D in the PTY sometimes failed to close the browser tab: the client's
  `window.close()` doesn't apply to tabs the user opened by URL or via Dia/Arc's
  quirky tab model, so the tab stranded with the shell already dead. Fix it by
  tracking the tab provenance _ambiently_ over the WS handshake instead of relying
  on the client's close.

  The daemon's `CdpClient` now subscribes to `Target.setDiscoverTargets` and, for
  every page-type target on its origin, injects a unique token via
  `Page.addScriptToEvaluateOnNewDocument` (re-runs on every reload, so the token
  survives the page's lifetime). The page echoes that token in a new
  `{type:"identify"}` WS message; the server resolves it to the CDP `targetId`
  and stores it on the socket. On a **clean** shell exit the same closeTab queue
  that serializes automation-run closes picks up the target — concurrent Ctrl+Ds
  never interleave — driving the browser's own close path via CDP (reliable where
  `window.close()` isn't). The client learns whether it's CDP-controlled via a
  new `{type:"cdp-controlled"}` ack and defers its own `window.close()` so the
  server-driven close settles without flashing the dead-session mask; it falls
  back to `window.close()` + mask if the CDP close doesn't land by the deadline.

  Non-zero exit codes skip the auto-close so the dead-session mask surfaces the
  failure. Tabs not on the CDP-attached browser fall back to the pre-existing
  `window.close()` path with no regression.

- Updated dependencies [83d1bbe]
  - @monotykamary/localterm-server@2.8.0

## 2.7.7

### Patch Changes

- Fix the diff viewer's per-line comment controls being occluded by the sticky
  line-number gutter. Both the `+` annotate button and the multiline
  drag-to-comment range highlight are positioned descendants of the line row
  painted before the sticky gutter (an opaque `bg-background` `z-10` descendant)
  in DOM order, so with equal `z-index` the later-painted gutter covered them —
  the comment bubble never appeared on hover and drags couldn't start, and
  saved/in-progress range tints stopped at the line-number column. Raised both to
  `z-20` so they stack strictly above the gutter.
- Updated dependencies
  - @monotykamary/localterm-server@2.7.7

## 2.7.6

### Patch Changes

- Add test coverage for the binary-output WebSocket paths shipped in 2.7.5: the client-side cross-realm ArrayBuffer dispatch fallback, the OutputBatcher's byte-buffer growth past the initial capacity, and the keep-warm rAF cadence; plus a server-side assertion that output frames arrive as raw binary ArrayBuffers rather than JSON text.
- Updated dependencies
  - @monotykamary/localterm-server@2.7.6

## 2.7.5

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.7.5

## 2.7.4

### Patch Changes

- 8d3ed91: Fix oversized input/textarea text on desktop that ignored `text-xs`. The default `Input`/`Textarea` classes used `text-base md:text-sm`; when a component overrode with `text-xs`, `tailwind-merge` stripped the conflicting base `text-base` but kept `md:text-sm` (a different variant), so `md:text-sm` (14px) won over `text-xs` (12px) at desktop widths. Swapped the base to plain `text-sm` so `text-xs` overrides cleanly at every breakpoint and dropped the `text-xs md:text-xs` band-aid it required. Affects the worktrees PR number field, setup-script and `.worktreeinclude` textareas, keep-awake caffeinate command input, diff-viewer line-comment box, and the find-in-terminal search input.
  - @monotykamary/localterm-server@2.7.4

## 2.7.3

### Patch Changes

- b1574cc: Harden the diff-viewer "caps the first paint of a large diff" jsdom test against CPU contention. The test stubs `requestAnimationFrame` and awaits the first paint, so it's correct in isolation (25/25), but jsdom's first paint of a 2500-line patch is CPU-bound and under turbo's parallel cross-package run it starves past vitest's 5s default — flaking sporadically. Added an inline per-test timeout (15s, matching the server's heavy-test precedent in `session.test.ts`) so contention can't blow the default.
  - @monotykamary/localterm-server@2.7.3

## 2.7.2

### Patch Changes

- 859bf00: Stop the server `foreground`-channel integration test from flaking under full-suite load. Extracted the poll + dedup logic into a `ForegroundWatcher` driven deterministically under fake timers (matching the existing pattern in `folder-watch-manager.test.ts`), with `Session` delegating to it. Replaced the load-sensitive real-PTY assertion with deterministic unit coverage of dedup, null-seed suppression, stream-forced `set()`, self-dispose on exit, and dispose — stricter coverage, zero OS-process timing in the loop.
  - @monotykamary/localterm-server@2.7.2

## 2.7.1

### Patch Changes

- eb1aeea: Stop the worktree setup script from re-running every time a worktree tab is opened. The `?cmd=` setup-script token is now cleared from the address bar once the session that ran it is established, mirroring the single-use `?run=` automation token — so reloads, reconnects, and copied/restore links open a plain shell at the worktree cwd instead of re-running installs and env copy.
  - @monotykamary/localterm-server@2.7.1

## 2.7.0

### Minor Changes

- Hide stale merged PRs from the toolbar indicator and diff viewer on base branches (main, master, dev, develop, staging, production) once they're older than a week. A merged PR lingering on a base branch — e.g. a main→production reverse-merge — is noise once it ages out; feature branches keep their merged-PR indicator indefinitely.

  - The server now forwards GitHub's `merged_at` on each detected PR (new `mergedAt` wire field).
  - The client's PR display state resolves to `null` for a merged PR past the TTL on a base branch, so the toolbar button, diff-viewer branch-mode auto-open, base-picker default, and header chip all drop it consistently.
  - New `BASE_BRANCHES` and `MERGED_PR_OVERLAY_TTL_MS` constants (7 days) in `apps/terminal/src/lib/constants.ts`.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.7.0

## 2.6.3

### Patch Changes

- 62eb023: Make the worktree modal height dynamic (content-sized up to a max) and animate the worktree list in on load instead of flashing a spinner.

  - Modal now sizes to its content with a `min(100%, 40rem)` cap instead of always filling to the max height, so short worktree lists no longer leave a large empty panel.
  - On load, the body starts at one row's height and animates smoothly to the virtualizer's total height; the in-body loading spinner is removed (the header spinner still signals loading) and the list fades in over 150ms.
  - @monotykamary/localterm-server@2.6.3

## 2.6.2

### Patch Changes

- 8b790ce: Use a muted gray for draft PR state instead of blue so drafts read as inactive, matching GitHub's draft treatment.
- Updated dependencies [8b790ce]
  - @monotykamary/localterm-server@2.6.2

## 2.6.1

### Patch Changes

- 7055b95: Clarify the worktree PR input placeholder so users know entering a number opens that PR as a worktree, instead of only showing the expected format.
- Updated dependencies [7055b95]
  - @monotykamary/localterm-server@2.6.1

## 2.6.0

### Patch Changes

- Updated dependencies [8f76ed3]
  - @monotykamary/localterm-server@2.6.0

## 2.5.1

### Patch Changes

- Updated dependencies [0abad5d]
  - @monotykamary/localterm-server@2.5.1

## 2.5.0

### Minor Changes

- 2a0858a: Reflect PR draft and merge-conflict states with Lucide icons in the toolbar and diff viewer

### Patch Changes

- Updated dependencies [2a0858a]
  - @monotykamary/localterm-server@2.5.0

## 2.4.1

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.4.1

## 2.4.0

### Minor Changes

- Add a battery floor guard to keep-awake: stop caffeinate when the machine is
  on battery power at or below a configurable percent (defaults to 20%), without
  changing the selected mode. The floor is discharge-only (never applies on AC)
  and enforced by adapting-polling `pmset -g batt` only while a mode wants
  caffeinate active — the next delay is 1/2 of the interpolated time-to-threshold,
  clamped to [5s, 15min]. Add a "Battery floor" selector to the keep-awake
  popover (Off / 10% / 15% / 20% / 30% / 50%); persist the choice to the
  caffeinate preferences file (v2 -> v3 migration defaults existing installs to
  20%). Fail-open on a missing battery or a transient pmset read, with a
  MAX-interval retry so the guard self-heals.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.4.0

## 2.3.0

### Minor Changes

- e6e4ac2: Add a per-project git worktree creation flow. Creating a worktree now happens
  without a form and lands under `~/.localterm/worktrees/<project>/` on a memorable
  adjective-noun branch (e.g. `clever-fox`). Two same-named repositories are put in
  distinct project folders via a per-repo marker. The main worktree can never be
  removed (server-enforced), the virtualized list no longer overlaps, and a
  `⌘/Ctrl+Shift+B` shortcut plus "Create git worktree" command-palette entry open
  the new worktree in a new tab.

### Patch Changes

- Updated dependencies [e6e4ac2]
  - @monotykamary/localterm-server@2.3.0

## 2.2.3

### Patch Changes

- Remove realtime diff viewer line animations
- Updated dependencies
  - @monotykamary/localterm-server@2.2.3

## 2.2.2

### Patch Changes

- Warm diff viewer prefetch on open for branch mode and pre-open git-dirty.
- Updated dependencies
  - @monotykamary/localterm-server@2.2.2

## 2.2.1

### Patch Changes

- 1d346bc: Fix realtime diff animation placement for deleted lines, handle add/remove/add-back edge cases, and add unit tests for the transition logic.
- Updated dependencies [1d346bc]
  - @monotykamary/localterm-server@2.2.1

## 2.2.0

### Minor Changes

- Animate newly added diff lines in realtime

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@2.2.0

## 2.1.6

### Patch Changes

- Move the alpha-mask `@xterm/addon-webgl` bundle from a hand-vendored minified
  copy to a `pnpm patchedDependencies` patch. No user-facing behavior change —
  the patched addon is byte-identical to the previously vendored bundle, and the
  alpha-mask WebGL renderer (per-quad vertex color + luma-as-alpha fragment
  shader + style-only glyph cache key) already shipped in 2.1.5. This release
  makes the patch pnpm-validated at install time so future `@xterm/addon-webgl`
  upgrades fail loudly instead of silently rotting.
  - @monotykamary/localterm-server@2.1.6

## 2.1.5

### Patch Changes

- f3c8035: Make diff viewer and automations modal sidebars span the full modal height.
  - @monotykamary/localterm-server@2.1.5

## 2.1.4

### Patch Changes

- 13df7c6: Show a fork PR's upstream base in the diff viewer picker, not the fork's origin.

  The diff viewer's base picker displayed `branchInfo.defaultBase` (always
  `origin/...` from the fast local lease), so even after the server-side diff
  compared a fork PR against its upstream base, the picker still read "origin" —
  a mismatch between what the picker showed and what the diff actually compared.

  The PR's base ref is now resolved once in `detectPr` (mapping the PR's base repo
  to a local remote, fetching the upstream branch when missing) and surfaced on the
  wire as `pr.baseRef`. The picker prefers it: a fork PR shows `upstream/<base>`
  and a same-repo PR (base repo is origin) shows `origin/<base>` — automatic from
  the remote-slug match, so normal PRs stay on the same remote. Falls back to the
  repo default when there's no PR or the base couldn't be resolved.

- Updated dependencies [13df7c6]
  - @monotykamary/localterm-server@2.1.4

## 2.1.3

### Patch Changes

- ea8aec5: Fetch a fork PR's upstream base ref when it isn't local, and resolve the PR on a cold cache.

  The previous fork-PR fix only resolved the base through existing remote-tracking
  refs — but the server never fetches, so a fork with `upstream` configured but
  never `git fetch upstream`'d had no `upstream/main` ref and silently fell back to
  the fork's own origin. Three failure modes now closed:

  - Missing upstream ref: when the upstream remote is configured but its tracking
    ref isn't local (the common fork state), `git fetch <remote> <branch>` (one
    branch, no tags/submodules, bounded by the spawn timeout and
    GIT_TERMINAL_PROMPT=0) creates it. A dead/slow upstream degrades to the repo
    default.
  - Cold PR cache: opening branch mode (manually, or via refresh) before
    `getGitBranchPr` landed used to silently fall back to origin. The diff path now
    resolves the PR inline via a deduped `detectPr` that shares any in-flight
    `getGitBranchPr` call, so it never races into a second GitHub round-trip.
  - Case-insensitive remote slug match: GitHub repos are case-insensitive and a
    remote URL's casing can differ from the API's canonical `full_name`.

- Updated dependencies [ea8aec5]
  - @monotykamary/localterm-server@2.1.3

## 2.1.2

### Patch Changes

- Compare a fork PR branch against its upstream base, not the fork's origin.

  A fork's `origin` is the fork itself, so the diff viewer was comparing a PR
  branch against the fork's own default branch (`origin/main`) instead of the
  upstream repo the PR actually targets. When the fork's default had drifted from
  upstream (commits not yet synced), those drift commits were mishandled in the PR
  diff — disagreeing with GitHub's Files changed and showing the wrong changes.

  The PR's base is now resolved through the base repo: `detectPr` captures the
  PR's `base.repo.full_name` and caches the PR per `(cwd, branch)`; branch-mode
  base resolution reads that cache (no GitHub round-trip on the diff path — the
  client's existing `getGitBranchPr` call populates it in parallel, and the
  viewer only opens branch mode once `branchInfo.pr` is truthy, so the cache is
  warm) and maps the base repo to its local remote (`upstream/main`) via
  `git remote -v`. Falls back to the repo default when there's no PR, no matching
  remote (upstream never added), or the ref isn't fetched locally.

- Updated dependencies
  - @monotykamary/localterm-server@2.1.2

## 2.1.1

### Patch Changes

- ee194bb: Fix dropped patches when a path spans multiple `diff --git` blocks or contains a space.

  The 2.1.0 subprocess backend paired `--numstat` entries with `--patch` chunks
  positionally. That broke in two ways, both leaving the per-file patch as
  `patchOmitted`:

  - A single numstat entry can span several `diff --git` blocks — a symlink
    deleted (mode 120000) and re-added as a regular file is emitted by git as a
    deletion + an addition sharing one path, so `--patch` has one more block than
    `--numstat` has entries. The positional lengths didn't match, so the safety
    check marked every file's patch as omitted.
  - Paths with a space get a trailing tab appended by git on the `---`/`+++` lines
    (a disambiguator), which numstat doesn't carry, so path keys didn't line up.

  Patches are now indexed by path (extracted from each chunk's `+++ b/...` /
  `--- a/...` / `rename to ...` header, with C-style unquoting and the trailing
  tab stripped) and concatenated when several blocks share one path. numstat
  remains the source of truth for the file list and counts. Verified against
  models.dev (5848 files): all files return their patch, and a symlink→regular
  transition correctly yields a single entry with a 2-block delete+add patch.

- Updated dependencies [ee194bb]
  - @monotykamary/localterm-server@2.1.1

## 2.1.0

### Minor Changes

- 0353741: Replace the es-git (wasm libgit2) diff backend with canonical git subprocesses.

  The diff viewer and its prefetch queue now read `git diff --numstat --name-status
--patch` and `git ls-files --others` instead of es-git's in-process libgit2.
  This eliminates the whole drift class that kept biting us:

  - libgit2's `DiffFile.isBinary()` returned false until `diff.stats()` was
    materialized (binary files read as text and got junk patches synthesized from
    utf8-decoded blob bytes — the latent regression fixed ad-hoc in 2.0.5).
  - jsdiff line counts diverged from git's own `--numstat`, so the badge totals and
    the diffs the user opened didn't always agree with what `git diff` shows in
    their terminal.
  - rename/copy detection and honoring of `core.*` config subtly differed from
    canonical git.

  What the user sees in their terminal is now exactly what we compute — the diff
  data is pulled from git itself, so the counts, binary detection, rename paths
  and patch bodies all match `git diff` by construction.

  Runtime requirement: git must now be on PATH for diff features (localterm's
  audience is dev terminals, where git is universal). With git absent, diff
  lookups degrade to `isRepo: false` rather than crashing.

  The per-`(cwd, mode, base)` cache layer from 2.0.5 is retained, so the viewer's
  per-file patch prefetch burst stays an O(1) map lookup with no subprocess when
  the cache is warm. Cold fill is 4 parallel `git` invocations (numstat,
  name-status, patch, untracked ls-files) instead of the previous one-tree-diff +
  per-file jsdiff, and per-keystroke summary reuses the cheap numstat-only path.

  Drops the `es-git` dependency (and its native per-platform binaries — no longer
  in `onlyBuiltDependencies`) and the `diff` (jsdiff) dependency entirely.

### Patch Changes

- Updated dependencies [0353741]
  - @monotykamary/localterm-server@2.1.0

## 2.0.5

### Patch Changes

- b6612c9: Cache the full diff pass per (cwd, mode, base) so the viewer's per-file patch
  prefetch queue is O(1) map lookups instead of O(files²).

  The diff viewer opens into branch mode and its prefetch queue then requests
  ~every changed file's patch. Each `getGitDiffFilePatch` call previously
  re-ran the whole-tree diff + a jsdiff for every file, so a large branch
  comparison (e.g. several thousand commits / ~20k files) blocked the daemon's
  event loop for the cumulative duration and made localterm unresponsive.

  Now the single full diff pass (one tree diff, one jsdiff per file — used for
  both counts and patch, where the old code ran jsdiff twice) is built once per
  `(cwd, mode, base)` and cached. The cache is invalidated on the git-dirty WS
  signal (before the summary push) with a TTL backstop. Hot per-file lookups
  drop from ~1.3s to ~0.15ms.

  Also drops `reconcileFileStats`: per-file jsdiff counts are non-negative by
  construction, so the negative-additions class of bug no longer exists (the
  wire schema's `.nonnegative()` can't be tripped). Removed `compute-patch`'s
  only count-drift consumer; the util stays (still builds the patches).

- Updated dependencies [b6612c9]
  - @monotykamary/localterm-server@2.0.5

## 2.0.4

### Patch Changes

- c03fac9: Fix the ambient PR indicator never showing for a branch with a PR (and the
  diff viewer opening without GitHub metadata). PR detection was raced against a
  150 ms cap (GIT_BRANCH_INFO_PR_TIMEOUT_MS) in /api/git/branches, which is far
  shorter than the GitHub REST API round-trip, so `pr` always resolved to null.

  Split the lease: /api/git/branches now returns pure-local branch refs + default
  base instantly (pr: null), and a new /api/git/branches/pr endpoint resolves the
  PR separately (bounded by Octokit's own timeout; degrades to null on missing
  token / network failure / no PR). The client leases both in parallel and merges
  `pr` into the branch-info lease, so the toolbar paints right away and the PR
  indicator / branch-mode metadata land when gh responds — no blocking, no
  false-null regression.

  Also fix a latent schema violation the split exposed: with `pr` now populated,
  the diff viewer opens in branch mode, whose per-file additions/deletions are
  reconciled toward git's `diff.stats()` aggregate. jsdiff's per-file patch counts
  overshoot the aggregate on large diffs (trailing-newline / line-ending drift),
  and the redistribution subtracted 1 unconditionally, driving zero-count files
  to -1 — which `gitDiffFileMetaSchema` (`.nonnegative()`) rejects, failing the
  whole file-list parse and showing "Couldn't load the diff". Extracted to
  `reconcileFileStats`, which only decrements files that have room, so per-file
  counts never go negative.

- Updated dependencies [c03fac9]
  - @monotykamary/localterm-server@2.0.4

## 2.0.3

### Patch Changes

- Revert the FontFace.status polling added to awaitFontReady in 2.0.2. CDP
  instrumentation of the running app proved the WebGL glyph atlas bakes at
  weight 400 with the Geist Mono face already loaded, so the font-readiness
  race this targeted was never the cause of the cold-reload boldening (which
  originates downstream in the alpha-mask render path). Keep the
  @fontsource/geist-mono/700.css import so bold text resolves to 700.
  - @monotykamary/localterm-server@2.0.3

## 2.0.2

### Patch Changes

- 1d0a0c9: Fix intermittent bold rendering of terminal text after reload. awaitFontReady
  now polls the real FontFace.status until "loaded" before resolving, so the
  WebGL glyph atlas is no longer cleared against an unloaded Geist Mono face
  (which re-rasterized regular text at a fallback weight). Also ship the missing
  @fontsource/geist-mono/700.css so bold text renders at 700 instead of 600.
  - @monotykamary/localterm-server@2.0.2

## 2.0.1

### Patch Changes

- 0371157: Arrange the monthly day-of-month selector in the automations schedule trigger into a 7-day calendar grid with weekday headers.
  - @monotykamary/localterm-server@2.0.1

## 2.0.0

### Major Changes

- 0de44bd: Replace the umbrella `git-refs-change` and internal `git-dirty` session events with granular namespace and operation events (such as `git-head-change`, `git-commit`, `git-checkout`, `git-merge`, etc.). Event-based automations now use an `events` array and fire when any selected event occurs. The automation form uses a new Notion-like multi-select search for picking events.

### Patch Changes

- Updated dependencies [0de44bd]
  - @monotykamary/localterm-server@2.0.0

## 1.42.0

### Minor Changes

- Refresh the diff viewer in realtime as working-tree changes happen in the background, and fix the lint scripts so they consistently enumerate source files.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.42.0

## 1.41.15

### Patch Changes

- 6a74c60: Wire the restart and stop commands to launchd when the localterm launchd service is loaded. Restart now uses `launchctl kickstart -k` and stop uses `launchctl stop`, with the original manual PID-based behavior as a fallback when launchd is not managing the daemon.
- Updated dependencies [6a74c60]
  - @monotykamary/localterm-server@1.41.15

## 1.41.14

### Patch Changes

- 76a5de7: Fix launchd auto-start respawn loop that caused continuous syspolicyd activity on macOS. The launchd plist now runs the daemon directly in the foreground with crash-only KeepAlive, and the start command exits cleanly when another instance is already running under launchd.
- Updated dependencies [76a5de7]
  - @monotykamary/localterm-server@1.41.14

## 1.41.13

### Patch Changes

- 749cd31: Drop the refresh button from the diff viewer header at the narrowest disclosure breakpoint so the close button remains reachable.
- Updated dependencies [749cd31]
  - @monotykamary/localterm-server@1.41.13

## 1.41.12

### Patch Changes

- Use consistent padding on modal overlays

  Replace `p-4 sm:p-6` with a fixed `p-5` on the diff viewer and automations modal overlays so the modal width scales smoothly with the viewport. The previous responsive breakpoint made the panel slightly wider as the viewport shrank past 640px, causing a subtle layout jump after the sidebar collapsed.

  - @monotykamary/localterm-server@1.41.12

## 1.41.11

### Patch Changes

- Highlight the active keep-awake trigger in the overlay and improve automatic command detection for script shims and versioned binaries.
- Updated dependencies
  - @monotykamary/localterm-server@1.41.11

## 1.41.10

### Patch Changes

- Fix diff viewer and automations modal bugs

  - Fix flash of missing sidebar on modal open (zero-width measurement guard + missing mounted dependency)
  - Fix forever-loading patches after refresh/close-reopen (PrefetchQueue.clear() no longer permanently bricks the queue)
  - Animate sidebar collapse/expand smoothly instead of abrupt layout jump
  - Remove compact split-diff fallback mode — split mode now always renders true side-by-side with horizontal scroll

- Updated dependencies
  - @monotykamary/localterm-server@1.41.10

## 1.41.7

### Patch Changes

- Fix launchd respawn loop causing syspolicyd CPU spins on macOS
- Updated dependencies
  - @monotykamary/localterm-server@1.41.7

## 1.41.4

### Patch Changes

- Fix flash of unhighlighted diff text during syntax tokenization
- Updated dependencies
  - @monotykamary/localterm-server@1.41.4

## 1.41.3

### Patch Changes

- b578aca: Make spawn-helper signing conditional to prevent syspolicyd CPU spike on every daemon start
- Updated dependencies [b578aca]
  - @monotykamary/localterm-server@1.41.3

## 1.36.0

### Minor Changes

- Extract `memoBy` utility from inline dedup patterns

  Replace scattered `Set`-based dedup loops and `[...new Set()]` spreads with a
  single `memoBy(items, keyFn)` utility that keeps the first occurrence per key
  — the same memo-table pattern as DataLoader's memoization layer.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.36.0

## 1.35.1

### Patch Changes

- Updated dependencies [0cc8ee0]
  - @monotykamary/localterm-server@1.35.1

## 1.34.0

### Minor Changes

- Anchor line numbers and add horizontal scroll in the diff viewer

  Both unified and split modes now use transform-based horizontal scrolling so line numbers stay fixed while the text content scrolls. Horizontal trackpad gestures and Shift+mouse wheel scroll both sides simultaneously in split mode, and scroll the text past anchored line numbers in unified mode.

  - @monotykamary/localterm-server@1.34.0

## 1.33.0

### Patch Changes

- Cache and prefetch syntax tokens in the diff viewer

  Tokenization results are cached by file path and content so revisiting a file renders highlighted code on the first paint with no flash. Patches now prefetch tokens on load, so neighbor files visited with j/k are also instant.

  - @monotykamary/localterm-server@1.33.0

## 1.32.0

### Minor Changes

- Add syntax highlighting to the diff viewer

  Diff lines are now tokenized with Shiki (JavaScript regex engine, `dark-plus` theme) and rendered with per-token color spans. Language is auto-detected from the file extension (TypeScript, Python, Rust, Go, CSS, JSON, and 25+ more). Unsupported languages fall back to plain text. Grammar modules are lazy-loaded — only the one needed is fetched when its diff is opened.

  - @monotykamary/localterm-server@1.32.0

## 1.31.0

### Minor Changes

- Add activity gate for automatic keep-awake mode

  When the activity gate is enabled (the default), automatic mode now only
  keeps the system awake while a recognized program is actively producing
  output. After 5 seconds of silence, caffeinate releases — so an idle
  coding agent at a prompt no longer holds a power assertion. Users who
  prefer the old behavior can toggle the activity gate off in the keep-awake
  menu.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.31.0

## 1.25.4

### Patch Changes

- fix: suppress startup red-dot favicon badge when no foreground process ran
- Updated dependencies
  - @monotykamary/localterm-server@1.25.4

## 1.25.3

### Patch Changes

- Fix optical centering of "A" badge in keep-awake automatic mode
- Updated dependencies
  - @monotykamary/localterm-server@1.25.3

## 1.25.2

### Patch Changes

- Fix zsh prompt reverting to macOS default when daemon is spawned from inside localterm
- Updated dependencies
  - @monotykamary/localterm-server@1.25.2

## 1.25.1

### Patch Changes

- Fix restart daemon dying on startup and plist missing PATH
- Updated dependencies
  - @monotykamary/localterm-server@1.25.1

## 1.25.0

### Minor Changes

- Add launchd install/uninstall commands and spawn-first restart handoff

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.25.0

## 1.24.1

### Patch Changes

- Updated dependencies [0d6f2e6]
  - @monotykamary/localterm-server@1.24.1

## 1.24.0

### Patch Changes

- Updated dependencies [a9466af]
  - @monotykamary/localterm-server@1.24.0

## 1.23.1

### Patch Changes

- Updated dependencies [ea65411]
  - @monotykamary/localterm-server@1.23.1

## 1.23.0

### Patch Changes

- Updated dependencies [9970740]
  - @monotykamary/localterm-server@1.23.0

## 1.22.0

### Minor Changes

- ffd6112: Give the keep-awake coffee control three modes: off, on, and automatic (the new default).

  The coffee button is now a dropdown like the settings menu. **Automatic** keeps the system awake
  only while a recognized program is running in a localterm session — `claude`, `codex`, `opencode`,
  and `pi` are detected out of the box, and you can add your own commands on top. Detection matches the
  full command line of processes running under each session's shell, so a CLI launched as
  `node …/claude` still counts. Automatic carries a small corner badge to set it apart, and the coffee
  icon tints to its warm accent only while keep-awake is actually engaged. The selected mode and your
  custom commands are owned by the daemon, persisted to `~/.localterm/caffeinate.json`, and broadcast
  to every tab so all open tabs stay in lockstep. macOS only, where `caffeinate` exists.

### Patch Changes

- Updated dependencies [ffd6112]
  - @monotykamary/localterm-server@1.22.0

## 1.21.0

### Minor Changes

- 4689b32: Load the git diff viewer instantly and render large diffs progressively. The viewer now fetches the changed-file list first (metadata only) and loads each file's patch on demand — with neighbour prefetch so arrow/`j`/`k` navigation stays instant — instead of fetching every file's patch up front. A selected file paints its first screen immediately and the rest streams in over animation frames without blocking input, replacing the old blocking "show all lines" button. Adds `GET /api/git/diff/files` and `GET /api/git/diff/file` endpoints; a single large file is no longer capped by the whole-response patch budget.

### Patch Changes

- Updated dependencies [4689b32]
  - @monotykamary/localterm-server@1.21.0

## 1.20.0

### Minor Changes

- 44cbd2a: Sync the toolbar overlay across all open tabs and add a keep-awake coffee button.

  Terminal settings (theme, font, size, line height, cursor, scrollback, padding, Nerd Font) now propagate to every other open tab the moment you change them — the same live-sync that automations already had. The new coffee button in the top-right overlay toggles a machine-wide `caffeinate -dims` keep-awake: the icon tints to a warm coffee tone when active, and because the daemon owns the single process and broadcasts its state, the toggle stays in lockstep across tabs. The button only appears on macOS, where `caffeinate` exists.

### Patch Changes

- Updated dependencies [44cbd2a]
  - @monotykamary/localterm-server@1.20.0

## 1.19.2

### Patch Changes

- d682087: fix: stop stale spinner/status lines when output contains non-Latin combining marks

  Claude Code measures text with `Bun.stringWidth`, which counts most non-Latin combining marks (Cyrillic, Hebrew points, Arabic harakat, Indic, CJK voicing, …) as a spacing column instead of zero-width. The terminal joined them onto the base, so any line containing one drifted Claude's relative-cursor math by a column and left stale lines behind — e.g. a frozen spinner frame — until a resize forced a full repaint. The width provider now mirrors `Bun.stringWidth` for those marks, but only in the normal screen buffer where Claude runs; full-screen TUIs (vim, less, tmux) in the alternate buffer keep correct combining-mark rendering.

  - @monotykamary/localterm-server@1.19.2

## 1.19.1

### Patch Changes

- 0118ccf: Dev tooling: manage pnpm via mise (`npm:pnpm@11.6.0`) instead of Homebrew and bump the pinned pnpm to 11.6.0, declaring the pnpm 11 `allowBuilds` gate for node-pty. No runtime changes.
- Updated dependencies [0118ccf]
  - @monotykamary/localterm-server@1.19.1

## 1.19.0

### Patch Changes

- Updated dependencies [cfe35c2]
  - @monotykamary/localterm-server@1.19.0

## 1.18.0

### Patch Changes

- Updated dependencies [8297fef]
  - @monotykamary/localterm-server@1.18.0

## 1.17.2

### Patch Changes

- 6f1fec7: Fix garbled terminal output and a mis-parked block cursor when a TUI app (e.g. Claude Code) finishes a task. The xterm unicode provider counted invisible format characters (zero-width space, BOM, soft hyphen, bidi marks, word joiners, Arabic prepended signs, Unicode tags) as 1 column while the app's width function counts them 0, so a single such character in an exactly-full line wrapped the row a column early and permanently desynced the app's relative-cursor diff renderer. These are now zeroed (joined into the preceding cell so they consume no column), and the inverse class of Unicode 15.1 wide characters the bundled data under-counts is widened to 2.
- Updated dependencies [6f1fec7]
  - @monotykamary/localterm-server@1.17.2

## 1.17.1

### Patch Changes

- 37ff69c: Fix input handling in the top-right overlay: the find overlay stayed visible but became click-through once the toolbar hover timer fired (clicks fell through to the terminal and it could not be refocused), and the toolbar's focus-preserving mousedown/keydown handlers also fired for the portaled automations/settings popovers, making their inputs unfocusable and sending typed text to the terminal.
- Updated dependencies [37ff69c]
  - @monotykamary/localterm-server@1.17.1

## 1.17.0

### Minor Changes

- 45cc782: feat: automations — server-managed cron jobs that open a tab and run a command

  The daemon now schedules cron-style automations (`~/.localterm/automations.json`,
  managed via `/api/automations`). When a job is due the server opens a new browser
  tab in the automation's directory, types the command into a fresh shell, and keeps
  the tab open as a visual record; zsh/bash sessions report the command's exit code
  back so the UI can show ran-and-succeeded. The terminal app gets an Automations
  popover in the top-right toolbar (⌘J / Ctrl+J, plus a command palette entry) with
  live status pushed over the WebSocket, and a `skills/localterm` SKILL.md teaches
  LLM agents the API (installable with `npx skills add monotykamary/localterm`).

### Patch Changes

- Updated dependencies [45cc782]
  - @monotykamary/localterm-server@1.17.0

## 1.16.4

### Patch Changes

- Fix git-dirty watcher to resolve .git by walking up the directory tree so it works from subdirectories
- Updated dependencies
  - @monotykamary/localterm-server@1.16.4

## 1.16.3

### Patch Changes

- Fix cwd watcher to use recursive fs.watch so subdirectory file changes are detected
- Updated dependencies
  - @monotykamary/localterm-server@1.16.3

## 1.16.2

### Patch Changes

- Replace debounce with leading-edge throttle for faster git-dirty signals, widen flaky test timeouts
- Updated dependencies
  - @monotykamary/localterm-server@1.16.2

## 1.16.1

### Patch Changes

- Watch the cwd directory for out-of-band working-tree changes
- Updated dependencies
  - @monotykamary/localterm-server@1.16.1

## 1.16.0

### Minor Changes

- Replace git diff summary polling with event-driven push model

  The browser no longer polls `/api/git/diff-summary` every 3 seconds.
  Instead, the server pushes the summary over the WebSocket when it
  detects changes via shell prompt hooks (OSC 7777) and `fs.watch` on
  `.git/index`, `.git/HEAD`, and `.git/refs/`. This eliminates the
  constant `git` subprocess spawns that kept `syspolicyd` at high CPU.

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.16.0

## 1.15.1

### Patch Changes

- 0c68b11: Revert terminal title to cwd-derived value when a foreground process (e.g. Claude Code) exits, instead of leaving the stale program name in the titlebar.
- @monotykamary/localterm-server@1.15.1

## 1.15.0

### Minor Changes

- c19be91: Add GitHub-style multiline comments to the diff viewer: press and hold a line's comment button and drag across lines (in either direction, in unified or split view) to select a range, then release to comment on it. The range highlights while dragging and on saved comments, Escape cancels an in-progress drag, and review prompts sent to the terminal reference the full line span (e.g. `src/main.ts L10-L14`)

### Patch Changes

- @monotykamary/localterm-server@1.15.0

## 1.14.1

### Patch Changes

- ab77032: forgiving toolbar hide on viewport edge
  - @monotykamary/localterm-server@1.14.1

## 1.14.0

### Minor Changes

- 323f25a: Add line annotations to the diff viewer with send-to-terminal review prompts: hover a diff line to leave a comment, then send all pending comments to the terminal as a formatted code-review prompt (pasted via bracketed paste, ready to submit to a CLI agent)

### Patch Changes

- @monotykamary/localterm-server@1.14.0

## 1.13.1

### Patch Changes

- fix(terminal): remove settings tooltip from overlay bar
- Updated dependencies
  - @monotykamary/localterm-server@1.13.1

## 1.13.0

### Minor Changes

- Add ⌘G/Ctrl+G keyboard shortcut to open the git diff viewer

### Patch Changes

- @monotykamary/localterm-server@1.13.0

## 1.12.0

### Minor Changes

- Add git diff viewer with server-side diff endpoints

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.12.0

## 1.11.3

### Patch Changes

- bf8c1e9: fix: correct emoji variation selector width during TUI streaming

  Remove `terminal.unicode.activeVersion = "15"` override that was downgrading xterm.js from the grapheme-aware `"15-graphemes"` provider to the naive `"15"` provider. The non-grapheme provider fails to join U+FE0F (variation selector-16) with the preceding emoji, treating it as a phantom width-1 cell. This shifts cursor positions by +1 per emoji, causing TUI redraws to leave ghost-line artifacts.

- Updated dependencies [bf8c1e9]
  - @monotykamary/localterm-server@1.11.3

## 1.11.2

### Patch Changes

- Fix security, CLI lifecycle, and frontend bugs from full codebase review

  - security: stripPort now treats `localhost:3417` correctly (was rejected with 403)
  - security: maxPayload capped at 256KB on WebSocket server
  - security: shell hook temp dirs use mode 0o700, rc files use mode 0o600
  - security: non-loopback bind warns about unauthenticated access
  - cli: PID verification is now tri-state (ours/not-ours/unknown) — unknown PIDs are no longer silently treated as "not ours"
  - cli: `start` no longer auto-stops an already-running instance on `already-running`
  - cli: `process.title` set before preflight to eliminate race in PID verification
  - cli: `stop` polls after SIGKILL; refuses to signal on unknown verification
  - cli: `PORT` env var no longer crashes on invalid values
  - cli: `stop`/`status` set `process.exitCode` on error; `isAlive` treats EPERM as alive
  - cli: PID/port/host writes are atomic (temp-file-then-rename); host persisted and used for health probes
  - frontend: Nerd Font toggle now actually changes the font family
  - frontend: reconnect probe no longer kills a fresh session when already connected
  - frontend: scroll-restore falls back to bottom when anchor exceeds buffer
  - frontend: custom scrollbar geometry updated on resize and after batcher flush
  - frontend: history.replaceState skips unchanged + try/catch for Safari rate limit
  - frontend: whitespace-only stored settings guarded; ref nulling in cleanup removed
  - frontend: favicon debounce uses timestamp-based self-adjusting timer (no flash, no churn)
  - refactor: createStoredSetting factory merged 22 load/store files into 11
  - refactor: deleted dead code (errors.ts, schemas.ts shim, merged shortcut factories)

- Updated dependencies
  - @monotykamary/localterm-server@1.11.2

## 1.9.1

### Patch Changes

- Fix terminal not scrolling to bottom after split-tab resize
- Updated dependencies
  - @monotykamary/localterm-server@1.9.1

## 1.2.0

### Minor Changes

- Generate 256-color palette from base16 theme via CIELAB interpolation

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.2.0

## 1.0.0

### Major Changes

- feat: add kitty graphics protocol support via xterm image addon beta

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@1.0.0

## 0.1.4

### Patch Changes

- Include initial title in the session WebSocket message so document.title updates immediately on load instead of staying as the default.
- Updated dependencies
  - @monotykamary/localterm-server@0.1.4

## 0.1.3

### Patch Changes

- Fix OSC 7 hook injection to prevent commands being echoed to the terminal on startup. Uses ZDOTDIR for zsh and --rcfile for bash instead of writing to the PTY stdin.
- Updated dependencies
  - @monotykamary/localterm-server@0.1.3

## 0.1.2

### Patch Changes

- Inject OSC 7 chpwd/PROMPT_COMMAND hooks into zsh and bash so CWD changes are detected immediately without polling or child process spawning.
- Updated dependencies
  - @monotykamary/localterm-server@0.1.2

## 0.1.1

### Patch Changes

- Replace title/cwd/foreground polling with stream-based detection

  The title was not updating immediately (or flashing) on directory changes because the server only emitted titles on a 500ms polling interval, and the client had two competing title sources that produced different formats at different times. All polling is removed in favor of parsing OSC 7 (CWD), OSC 0/2 (title), and DECSET/DECRST 1049 (foreground process) directly from the PTY output stream. The lsof/proc CWD resolver is also removed, eliminating syspolicyd pressure on macOS.

- Updated dependencies
  - @monotykamary/localterm-server@0.1.1

## 0.1.0

### Minor Changes

- Show only the tail folder name in the titlebar instead of a truncated path

### Patch Changes

- Updated dependencies
  - @monotykamary/localterm-server@0.1.0

## 0.0.14

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.14

## 0.0.13

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.13

## 0.0.12

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.12

## 0.0.11

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.11

## 0.0.10

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.10

## 0.0.9

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.9

## 0.0.8

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.8

## 0.0.7

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.7

## 0.0.6

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.6

## 0.0.5

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.5

## 0.0.4

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.4

## 0.0.3

### Patch Changes

- fix
- Updated dependencies
  - localterm-server@0.0.3

## 0.0.2

### Patch Changes

- Fix `posix_spawnp failed` error on first shell spawn after `npm install -g localterm`.

  node-pty's prebuilt `spawn-helper` binary loses the executable bit through some npm install paths. We now `chmod 0o755` it lazily inside the `Session` constructor so the very first spawn always works, regardless of how the package was installed (npm, pnpm, yarn, monorepo, global, local).

- Updated dependencies
  - localterm-server@0.0.2

## 0.0.1

### Patch Changes

- Initial public release.

  `localterm` is a browser-based terminal: one browser tab is one persistent PTY session. The CLI (`localterm start`) spins up a Hono + node-pty + headless-xterm daemon at `http://localterm.localhost:3417/` and ships the xterm.js front-end in the same package. Sessions are addressed by friendly `adjective-animal-suffix` ids in the URL path; closing a tab retires its shell after a 30-second grace window.

- Updated dependencies
  - localterm-server@0.0.1
