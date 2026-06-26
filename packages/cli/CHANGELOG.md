# localterm

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
