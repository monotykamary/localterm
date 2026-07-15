# localterm-server

## 2.64.0

### Minor Changes

- dca792f: Add a reusable design-token toast and move the pasted-image notice to the top.

  - New `components/ui/toast.tsx` wraps `@base-ui/react/toast` in the app's design tokens, with kind-tinted status icons (spinner / check / alert) and the popover/modal enter–exit animation (fade + zoom + slide).
  - The pasted-image toast now appears at the top of the terminal instead of above the on-screen keyboard, upserts in place via a stable toast id, and lets the toast manager own its timers (the manual setTimeout / unmount cleanup is gone).

## 2.63.1

### Patch Changes

- 6dca6eb: Fix mobile multi-viewer and new-shell interactions.

  - Coordinate xterm-generated terminal query replies so only the active viewer
    answers the PTY, preventing duplicate OSC and DSR responses when a phone is
    attached while preserving input from every viewer.
  - Treat New shell as an explicit fresh spawn. Phones and tablets now reuse the
    current terminal surface instead of opening a PWA window with browser chrome;
    desktop continues opening a separate tab.

## 2.63.0

### Minor Changes

- 338389c: Reopen your last workspace tabs on start, and resume your active shell on mobile.

  - On daemon start, reopen the browser tabs you had open last — in the same
    directories and shells — via the automation browser's CDP connection: a
    tmux-resurrect/herdr-style restore of the workspace layout. The shells
    themselves don't survive a stop, so only the arrangement comes back;
    automation-run tabs and shells you'd closed are skipped. Opt out from
    Settings → Sessions ("Reopen tabs on start").
  - On phones and tablets, opening localterm attaches to your most recently
    active shell instead of starting a new one, so you land on the build or
    agent run you just started on another device. An explicit attach (a shared
    session QR) always wins regardless. Opt out from Settings → Launch
    ("Resume last shell on mobile").

## 2.62.4

### Patch Changes

- 8cc0e9e: Lower input-to-display latency for synchronized terminal applications without changing Localterm's streaming throughput path.

  The server now recognizes DEC 2026 synchronized-output completion across PTY chunk boundaries and flushes that complete redraw immediately, while unsynchronized applications retain the existing anti-flicker idle window. For small output that immediately follows terminal input, the WebGL client consumes xterm's already-pending render once instead of waiting for its animation frame; autonomous output, large frames, hidden tabs, DOM fallback, compression, backpressure, and alpha-mask rendering remain on their existing paths.

## 2.62.3

### Patch Changes

- d472583: Forward held Ctrl+Tab chords to foreground terminal applications.

  Ctrl+Tab and Ctrl+Shift+Tab now become legacy Tab and BackTab input while a foreground application owns the PTY, allowing prefix-driven multiplexers such as Herdr to cycle panes without the browser consuming the chord. Idle shells still defer modified Tab to the browser, and Cmd+Tab remains reserved for the operating system.

## 2.62.2

### Patch Changes

- 5ec4541: Revert `@fontsource/geist-mono` to 5.2.7 and lock it with a pnpm workspace override.

  A blanket `chore(deps): update all dependencies to latest` had bumped the exact
  `5.2.7` pin back to `5.2.8`, which packages Geist 1.7.0. Geist 1.7.0 collapses
  every coding ligature (`:=`, `=>`, `!=`, `==`, `->`, `-->`, `>=`, `<=`) to a
  single cell under the `liga` feature; xterm.js's fixed-cell ligature model then
  left-clips the ligature (the colon in `:=` vanishes) and shifts trailing glyphs
  one cell left. 5.2.7 (Geist 1.401) emits each ligature as a multi-cell
  substitution so xterm renders correctly.

  The exact package.json pin alone was not enough — a wholesale `pnpm update -L`
  rewrites the specifier. A new `overrides` entry in `pnpm-workspace.yaml` forces
  `@fontsource/geist-mono` to `5.2.7` workspace-wide, so the lockfile resolves to
  5.2.7 even if a future update rewrites the consumer range. `apps/terminal` stays
  pinned exactly to `5.2.7` as well.

  Upstream Geist 1.7.0 ligature regression: vercel/geist-font#201, #231.

## 2.62.1

### Patch Changes

- 15ccea8: Update all dependencies to their latest versions, including TypeScript 7,
  commander 15, @hono/node-server 2, hono 4.12, @vitejs/plugin-react 6,
  open 11, zod 4.4, @base-ui/react 1.6, shiki 4.3, tailwindcss 4.3, and
  React 19.2.x patch updates.

## 2.62.0

### Minor Changes

- 23ab217: Improve the mobile terminal and on-screen keyboard experience.

  The in-app keyboard now defaults to a compact 85% scale and can be customized from an Alt-key bottom-left swipe. Its settings include keyboard height, terminal font size and line spacing, haptics, key previews, and key repeat. A bottom-right swipe on Enter dismisses the keyboard.

  On touch devices, the top-right ambient action overlay stays hidden while the keyboard is down so it cannot block an app underneath, then returns while the keyboard is visible.

## 2.61.5

### Patch Changes

- a27061d: Drive foreground-process detection from shell hooks instead of polling
  `pty.process`. zsh and fish emit OSC 7777 `fg;<token>` (preexec) and `fg-idle`
  (precmd) via native hooks; bash uses a chained DEBUG-trap preexec (preserves
  any user DEBUG trap) plus a precmd `fg-idle`; the initial-command-eval hook
  also emits `fg;<token>` so worktree/automation tabs detect their program. The
  alt-screen stream signal stays as a fallback for unhooked shells (sh/dash), so a
  closed tab never reaps a running TUI. This removes the per-session 250ms
  `pty.process` poll, the `ps -o tpgid` shell-alias learner, and the
  `ForegroundWatcher` — eliminating the subprocess churn that kept syspolicyd
  warm on macOS. Keep-awake's automatic mode now short-circuits the `ps`
  process-tree walk when a session's hook-reported foreground name is itself a
  trigger (the common case: the user runs vim/ffmpeg/etc. directly), falling
  back to the walk only for child-process triggers (make -> ffmpeg) and
  unhooked shells. Adds `harness/fish-hook/` (run.sh + run-bash.sh): container
  e2e that run the real fish and bash hooks and assert the OSC sequences land.

## 2.61.4

### Patch Changes

- 0ed0866: Mute desktop notifications on the tab already viewing the session.

  The daemon fans each OSC 9 notification out to every connected tab. A tab already viewing the emitting session in the foreground can see the result on screen (e.g. pi finishing a turn), so it now skips the OS notification instead of duplicating what the user is watching. The check uses `document.hasFocus()` rather than `document.hidden` so a localterm window left visible behind another app still pings when focus leaves it.

## 2.61.3

### Patch Changes

- 330a4f0: Prevent Android's system keyboard and the terminal on-screen keyboard from appearing together.

  Touch terminals now keep xterm's helper textarea read-only with `inputMode="none"`, explicitly dismiss any active native IME before opening the in-app keyboard, and retire the in-app keyboard before a control or input outside the terminal takes focus. Other app inputs continue to use the system keyboard normally.

## 2.61.2

### Patch Changes

- 6ec2da5: Make pasted images ephemeral and session-scoped; use a lucide corner icon for the
  keyboard swipe.

  A pasted or picked image is now written to a session-scoped temp dir under the
  OS temp root (not the project cwd) and reaped when the session is torn down, so a
  paste lives only as long as the session that received it. The Ctrl-key swipe's
  corner hint is the lucide image icon (matching the toolbar button) instead of an
  emoji.

## 2.61.1

### Patch Changes

- 9e140df: Move image upload onto a Ctrl-key swipe instead of a dedicated keyboard key.

  The image-upload affordance added a key to the on-screen keyboard's bottom
  row, which threw off the layout. It now lives on a bottom-left slide of the
  Ctrl key (the framed-picture corner), reusing the keyboard's existing slide
  mechanic, so the bottom row keeps its original four-key shape.

## 2.61.0

### Minor Changes

- 199fe7f: Preview repository files directly from automation logs and make macOS-style terminal editing shortcuts portable across shells and TUIs.

  Backtick-wrapped relative file paths in automation output are now clickable. Images use the existing guarded asset route, while text files open in a new preview modal backed by a cwd-contained `/api/file/content` endpoint with a 1 MB limit and binary-file rejection.

  Physical xterm input and the on-screen keyboard now share readline/pi-compatible editing sequences: Option or Control plus Left/Right moves by word, Command plus arrows moves to line boundaries, and Command plus Backspace deletes to the beginning of the line. Modifier-arrow input no longer leaks unbound xterm CSI tails such as `;3D` into default macOS bash prompts.

## 2.60.0

### Minor Changes

- 5699423: Paste an image from the phone (or desktop clipboard) onto the terminal.

  The PWA's input surface was strictly text: `terminal.paste(text)` into xterm's
  off-screen textarea, with no `paste`/`drop` listener and no notion of a binary
  blob, so a pasted screenshot or photo was silently dropped. The WebSocket
  `input` message is a capped text string written straight to the PTY, and the
  `@xterm/addon-image`/`-clipboard` addons are output/OSC-52 only — neither
  touches input.

  A new `POST /api/upload-image` route accepts a multipart image Blob (auth-gated
  like the rest of `/api`, gated to a raster image-type allowlist that excludes
  SVG, capped at 32 MB, with a cwd-containment guard), writes it into the
  session's cwd as `pasted-<ts>-<id>.<ext>`, and returns the absolute path. The
  client then pastes that path (shell-quoted) into the prompt via the existing
  bracketed-paste pipeline, so it lands without executing and the user can pipe
  it to a viewer, hand it to an agent, etc.

  Entry points: an attach button in the action toolbar (phone/tablet) and an
  image key on the on-screen keyboard both open the system photo/file picker —
  the reliable cross-platform path, since iOS Safari blocks clipboard image
  reads and mobile paste into the hidden textarea is unreliable. On desktop,
  Ctrl/Cmd+V and drag-drop onto the terminal are handled by capture-phase
  `paste`/`drop` listeners that intercept an image paste before xterm reads the
  clipboard's empty text representation (text pastes fall through untouched). A
  transient toast reports the upload and any failure.

  The Android share-sheet `share_target` (manifest + service-worker stash +
  cold-start cwd handoff) is intentionally deferred to a focused follow-up; the
  attach button already covers the "get an image from my phone onto the terminal"
  intent on both Android and iPhone.

## 2.59.2

## 2.59.1

## 2.59.0

### Minor Changes

- a4f052e: Add `localterm session current` — a single self-reference call that resolves
  the localterm session the calling process is running in, so an agent inside a
  PTY can get its own context (id, cwd, title, state, attached-tab count) without
  scanning `session ls` and guessing which row is its own.

  The daemon now injects `LOCALTERM_SESSION_ID` into every PTY's env at spawn
  (inherited by all child processes), so the id is always locally available:
  `echo "$LOCALTERM_SESSION_ID"` reads it with no daemon call, and
  `localterm session current` (or `--json`) resolves it against
  `GET /api/sessions/:id` for the full live session object. It degrades to the
  bare id when the daemon is unreachable, and reports and exits non-zero when
  not running inside a localterm PTY or when the env id isn't a live session.

  - Server: stamp `LOCALTERM_SESSION_ID` on every spawned PTY; add it to the
    `PTY_ENV_DENYLIST` so a daemon spawned inside a tab can't leak its own.
  - CLI: `localterm session current [--json]`, reusing the existing
    `GET /api/sessions/:id` (no new endpoint).
  - Docs: the localterm skill and the sessions/exec reference cover the env var,
    the command, and the degrade/error semantics.

## 2.58.1

## 2.58.0

### Minor Changes

- 0023c3d: Promote terminal font settings to daemon-managed state, mirroring themes. The
  active font id, the user-entered custom family, and the Nerd Font / ligatures
  toggles are now stored in `~/.localterm/fonts.json` and shared with the
  `localterm font` CLI and every browser tab — so a custom font set in one browser
  profile (or from the CLI) loads by default in a new terminal, instead of being
  stranded in per-browser `localStorage` (which is scoped per profile, so a
  custom font never followed you across profiles/devices the way a custom theme
  already did).

  - Server: a `FontStore` (`~/.localterm/fonts.json`, v1) with `GET`/`PUT /fonts`
    and a one-time `POST /fonts/migrate`, broadcasting `{type:"fonts"}` over each
    tab's WebSocket on every mutation. The built-in font catalog moves into a
    shared `terminal-fonts.ts` (re-exported by the app, which keeps the
    browser-only CSS `family` string the daemon never stores).
  - CLI: `localterm font list|get|set|family|nerd-font|ligatures`, with
    tab-completion (`font set` completes built-ins + `custom`; the two toggles
    complete `on`/`off`).
  - Terminal: reconciles against the daemon on mount, pushes each font change to
    it, and applies the `{type:"fonts"}` broadcast; a one-time migration moves
    the legacy `localStorage` font state into the store on first contact with an
    uninitialized one, so an upgrade never loses the user's font selection.

## 2.57.0

### Minor Changes

- Add an npm update-check workflow: the daemon checks for new localterm releases on a schedule and surfaces available updates through the CLI banner (`localterm start`/`status`), a new `localterm update` command, and a settings-panel indicator in the terminal UI. Honors `LOCALTERM_SKIP_UPDATE_CHECK=1`.

## 2.56.3

### Patch Changes

- 02a6d36: Stop the CDP keepalive from tearing down a live socket on an idle probe.

  The daemon's persistent CDP WebSocket has a background keepalive that probes liveness with a `Target.getTargets` round-trip after a quiet window, so a half-open socket left by a laptop sleep is torn down proactively instead of stalling the next automation run. Its `.catch` tore down the socket on ANY error — including a `CdpReplyError`, which is the browser successfully answering the probe with a CDP error result on a perfectly healthy socket. Every other teardown path (`openBackgroundTab`, `closeTab`) was patched in ec9fd0a to skip teardown on a `CdpReplyError` — a reply must never drop the one socket kept for the daemon's lifetime, or the forced reconnect re-fires the browser's remote-debugging consent prompt on every run — but the heartbeat probe was missed. Add the same guard: a CDP error reply now resets the quiet clock (via `onMessage`) and keeps the socket; only a transport drop or a probe timeout is genuinely stale.

  The probe also rode on the 5s per-call timeout with no grace, so a slow-but-live browser (post-wake scheduling delay, a momentary main-thread block on a devtools fork like Dia/Arc) missed the window and lost its socket. Give the probe its own generous reply-wait — `CDP_HEARTBEAT_GRACE_MS` (15s, mirroring `WS_HEARTBEAT_GRACE_MS`'s "one grace chance before terminate") — so a live socket that's merely slow to answer is reused instead of dropped. Kept under the interval so a probe never overlaps the next tick.

## 2.56.2

### Patch Changes

- 7d0e35d: Fix a notification click opening a second client on a session already viewed in another browser profile. Notifications now appear only in the profile that hosts the session (suppressed elsewhere via a per-session `hasViewers` flag the server fans out), so a click focuses that terminal and raises its window; an orphaned session with no open tab reopens in a fresh tab instead of repurposing one in use.

## 2.56.1

### Patch Changes

- d479e55: Run the diff viewer's open-in-neovim initial command via the shell's prompt hook, same as automations and worktree setup scripts.

  `nvim <path> && exit` was still forced through the at-spawn PTY write because fullscreen TUIs were excluded from the hook-eval path. That special case is removed: any initial command on a hooked shell (zsh/bash/fish) now runs through `LOCALTERM_INITIAL_COMMAND` + prompt-hook `eval`, so open-in-neovim no longer races the line editor's ECHO. Unhooked shells keep the at-spawn PTY write (no hook to eval with).

## 2.56.0

### Minor Changes

- d920c08: Make clicking an OSC 9 desktop notification reliably focus the localterm tab, and deliver notifications to all of a user's tabs regardless of which session they're viewing.

  Previously the notification was shown with a main-thread `new Notification()` whose `onclick` called `window.focus()` — the path browsers don't honor for raising a background tab, so the click did nothing in Chrome/Firefox/Edge. The terminal now shows the notification through the service worker registration (`registration.showNotification`) so the click fires the SW's `notificationclick` event, which focuses an open localterm tab via `WindowClient.focus()` (the API browsers do honor) and switches it to the emitting session — or opens a new tab seeded with `?sid=` if none is open. Falls back to the old `new Notification()` path when no SW is active (dev / SW not yet controlling).

  The daemon also no longer restricts an OSC 9 notification to clients viewing the emitting session. It now fans the message out to every client currently viewing any session owned by the same identity, so a user who stepped away to another session still gets the ping. The fan-out is owner-scoped so a notification never crosses an identity boundary. The message now carries `sessionId` (the emitting PTY) so the SW click can target it; the per-session notification tag coalesces the copies the daemon fanned out across the user's tabs into a single OS notification.

## 2.55.3

### Patch Changes

- 2567b52: Add a "clear thread" action that restarts a thread-mode agent automation from a fresh session.

  Thread agent runs resume a persistent session on each fire, and the existing "Compact now" compacts that session in place to reclaim context. There was no way to start over short of deleting the automation. The automations modal's per-automation toolbar now has a refresh button (next to Compact) for thread agent automations that deletes the persisted session file so the next fire begins a blank branch — two-click confirm, since it drops the whole thread's context. Backed by `POST /api/automations/:id/clear-thread` (409 `not_thread` for fresh/shell runs, mirroring the existing `not_compactable` guard on `…/compact`).

## 2.55.2

### Patch Changes

- 26c32e0: Bump root devDependencies: @types/node, turbo, knip, @voidzero-dev/vite-plus-core, vite-plus.

## 2.55.1

### Patch Changes

- 62f8cd9: Fix the foreground watcher permanently misclassifying a `node`-based program (pi, `pnpm`, `npm`, `npx`, …) as the idle shell, so the tab favicon and session picker stayed grey ("ready") instead of blue ("alive-quiet") while the program ran quietly.

  On macOS the watcher's shell-name learner (`confirmShellProcessName`) cached the foreground comm node-pty reported _before_ a separate `ps -o tpgid` read. A short-lived program that exited in the ~5-20ms window between those two reads left `tpgid == pid` (shell idle) while the caller still held the program's comm, so the learner cached that comm — e.g. `"node"` — as the shell's name for that shell path. Once poisoned, the cache (a module-level map keyed by shell path, never invalidated for the daemon's lifetime) made every later session filter that comm as the shell: `inferForegroundProcess` returned `null` for a genuinely-foreground `node` program, so `hasForeground` read false and `computeState` returned `"ready"`. The keep-awake trigger was unaffected (it walks the process tree and reads the command line, which sees `pi`/`node` directly), so the machine stayed awake while the favicon and picker showed grey — and `htop`/`python`/`bash` scripts were unaffected since their kernel comm isn't `"node"`.

  The learner now re-reads the foreground comm via a getter _after_ `tpgid` confirms the shell is idle, so the cached name is the shell's actual comm — never the just-exited program's — closing the TOCTOU race. A daemon restart clears any already-poisoned cache.

## 2.55.0

## 2.54.0

### Minor Changes

- 8045feb: Add age-encrypted secrets export/import (CLI + UI). `localterm secret export`
  and `secret import` round-trip every secret's value through a
  passphrase-protected age file (interoperable with the stock `age` CLI); the
  Secrets modal gets matching Export/Import buttons. Values never leave the
  daemon in plaintext — only ciphertext crosses the HTTP surface, and the
  passphrase transits once (same posture as `secret set`). Import reuses the
  existing secret write path so shim re-bakes and the capacity gate stay
  identical to a manual save.

## 2.53.2

### Patch Changes

- ec9fd0a: `closeTab` no longer tears down the persistent CDP socket when `Target.closeTarget`
  returns a CDP error reply — the normal case where `window.close()` already closed
  the tab. The reconnect it forced re-fired the browser's remote-debugging consent
  dialog on every automation run (close-tab-when-finished), because every fresh
  WebSocket upgrade re-prompts. Only a transport drop or a call timeout now tears
  the socket down; a CDP reply (e.g. "No target with given id found") is swallowed
  and the one socket kept for the daemon's lifetime is preserved. `openBackgroundTab`
  gets the same guard so a CDP denial no longer triggers a spurious reconnect either.

## 2.53.1

### Patch Changes

- 9741b94: `closeTab` no longer orphans a tab when Ctrl+D closes a shell while the daemon's
  persistent CDP socket is momentarily down (sleep/wake, a transient WS error, or
  the heartbeat tearing down a half-open socket). It was the only CDP consumer
  that bailed on `!isConnected()` without reconnecting — `openBackgroundTab`,
  `openForegroundTab`, and `findTargetByUrl` all re-establish the socket first — so
  a **clean** shell exit landing while the debug WS was down silently skipped the
  close. The client had already been told the tab was CDP-controlled, so it
  deferred its `window.close()` fallback past the 1s `AMBIENT_TAB_CLOSE_DEADLINE_MS`
  deadline, and on a URL-opened tab (the principal localterm open path) that
  fallback is a no-op — leaving the dead-session mask behind (the "modal popup").
  `closeTab` now reconnects (one retry if the close itself fails on a stale
  mid-close socket), so it lands the close against the still-valid targetId the
  moment the socket comes back rather than dropping it on the floor.

## 2.53.0

## 2.52.1

## 2.52.0

### Minor Changes

- a9f4261: Track per-browser-profile clients in the session list. A new `?wid=` WS-upgrade
  param carries a per-browser-profile handle the terminal mints into `localStorage`
  (which the browser partitions per profile, so every tab of one profile shares it).
  The daemon tags each attached client with it and breaks the session list's
  `clients` count down by profile in a new additive, optional `clientProfiles` field
  (`{ windowId, count }[]`). Back-compat clients that don't send `wid` group under
  `""`, and the field is optional so an older daemon's responses still parse.

## 2.51.0

## 2.50.0

### Minor Changes

- 2b2dbce: Event automations now detect git ref changes from any source, not just a live
  localterm session. A new daemon-global `AutomationGitWatcher` arms a recursive
  `fs.watch` per event-automation cwd that selects at least one git event, and on
  `.git` changes classifies the affected repo (reusing the per-session
  `GitDiffWatcher` machinery) — emitting the same ref events
  (`git-commit`/`git-merge`/`git-fetch`/…) into `SessionEventManager`.

  This closes the gap where a commit from a non-localterm process — a headless
  agent run, an editor, an SSH session — or a commit in a repo with no open
  localterm tab produced no event, because `git-commit` was emitted only by a
  live session's per-session `GitDiffWatcher` fs.watching that repo's `.git`.
  New repos created after the watch armed are covered: `git init` seeds the empty
  tree, then the first commit classifies against it. Dependency caches under
  `node_modules` are excluded so installs don't spuriously fire automations.

## 2.49.1

### Patch Changes

- e52b39a: Restore the pre-command git-dirty and re-push the ambient summary on promote.

  The hook-eval change that ran the automation's initial command inside the precmd hook (instead of typing it into the PTY) moved the command ahead of `__localterm_git_dirty` in the prompt chain, so for zsh/bash the first `git-dirty` only fired once the command finished — leaving the ambient git-diff overlay without an update signal while a git command was running (it didn't show or update until the command returned). The hook now emits a `git-dirty` before the `eval`, mirroring fish (which already prints it first in `fish_prompt`), so the overlay reflects the tree state as the command begins and the regular post-`eval` `git-dirty` still fires when it ends.

  The overlay could also be stranded blank on a fresh attach: the coordinator pushes `git-diff-summary` straight to the wire (bypassing the pending buffer), but the `cwd` control frame is buffered and flushed on promote, and the client nulls its summary on `cwd` — so a summary that landed while the client was still pending could be wiped by the belated `cwd` reset, with nothing to re-push. `GitMetadataCoordinator` now exposes `replayLastSummary`, called at the end of `promote()` so the cached summary lands after the buffered `cwd` flush and the overlay is guaranteed populated on the now-live client. No-op when no summary is cached yet (the in-flight compute still broadcasts on completion).

## 2.49.0

## 2.48.1

## 2.48.0

### Minor Changes

- 8e0e2d9: Add a per-automation "clear run history" action.

  A single automation's run history can now be cleared without wiping the whole Triage inbox. `POST /automations/:id/clear-history` empties that automation's `runs` array while keeping the automation, its run-count, and lifecycle (use `POST /automations/:id/reset` to also restart a finished automation). The Automations modal's per-automation History section gains an eraser button (two-click confirm) that calls it, leaving every other automation's runs intact — the existing `POST /triage/clear-history` all-clear is unchanged.

### Patch Changes

- 6509046: Run a non-fullscreen initial command via the shell's prompt hook instead of typing it into the PTY.

  An initial command (an "open in neovim" tab, a worktree's setup script, or an automation shell-runner command) was written to the PTY, so the line discipline's ECHO and the line editor's char-echo raced it: at spawn the command floated above the not-yet-rendered prompt, and at the first prompt's early signals (git-dirty, bracketed-paste-enable DECSET 2004) ECHO was still on, so the first character double-echoed (`ggit pull …`) and a bracketed paste was worse (the whole command line-discipline-echoed plus block-inserted).

  For a hooked shell (zsh/bash/fish) the command is now passed through a `LOCALTERM_INITIAL_COMMAND` env var and run by the existing prompt hook via `eval` (in precmd / PROMPT_COMMAND / fish_prompt), instead of being typed. It never goes through the line editor's typed-input path, so it can't race ECHO or double-echo — no floating, no doubled character, no delay. The hook copies the env var into a local and unsets the env var BEFORE eval (so the command string isn't inherited by child processes the command spawns, and the hook runs once), prints the command (prefixed `+`), evals the local, and emits the automation-exit OSC with the eval's exit status. `LOCALTERM_INITIAL_COMMAND` is on the PTY env denylist so a stale or inherited value from the daemon env can't reach the hook — the constructor's explicit set is the only source. The server side is unchanged: the hook emits the same `\e]7777;automation-exit;N\a` OSC the count-based hook already emitted, and `parseOscAutomationExitFromChunk` parses it the same way (it arrives at precmd #1 instead of prompt #2, which the server doesn't track).

  Fullscreen TUIs (nvim/vim/less/htop/… — detected by the command's first token) and unhooked shells (sh/dash/arbitrary) still take the at-spawn PTY write. A fullscreen TUI clears the screen on alt-screen enter, so the line discipline's echo of the typed command is invisible; running a full-screen app inside a precmd hook is fragile, so it keeps the PTY path. Unhooked shells have no prompt hook to eval with. The doubling for those is the same as before (and for fullscreen TUIs it's invisible).

## 2.47.0

### Minor Changes

- Open run logs at the top with a scroll-to-bottom affordance.

  Thread-mode agent run logs force-scrolled to the bottom on load while fresh/shell logs stayed at the top. The thread auto-scroll on load is dropped so both log kinds open at the top, and a hovering bottom-right "scroll to bottom" button appears only when the reader isn't pinned to the bottom.

  A scroll listener plus a `ResizeObserver` over the scroll container and its content keep the button's visibility in sync with manual scrolling, viewport resizes, and content growth (transcript load, the live poll, a tool entry expanding). The `active-run-id` dependency re-attaches the observer after the not-found branch. A `RUN_LOG_AT_BOTTOM_THRESHOLD_PX` tolerance keeps subpixel rounding from flickering the button.

## 2.46.0

### Minor Changes

- 89fcd1a: Push terminal theme changes to open tabs in realtime over the WebSocket.

  Theme mutations (import / set active / delete / migrate) now broadcast the full
  theme state to every open tab's PTY WebSocket as
  `{type:"themes", activeThemeId, customThemes, initialized}`, so a
  `localterm theme set`/`import`/`delete` — or a change made in another browser
  tab — updates every open terminal instantly. The browser applies the pushed
  state directly; the 15 s reconcile poll is gone, replaced by a one-shot mount
  read (plus the one-time `localStorage`→server migrate on first contact with an
  uninitialized store).

## 2.45.0

### Minor Changes

- add683c: Add CLI + server management for terminal themes, shared with the browser UI.

  Terminal themes (the built-in catalog + user-imported customs + the active selection) are now server-managed state in `~/.localterm/themes.json`, so the `localterm theme` CLI and every browser tab share one source of truth — replacing the per-browser `localStorage` the UI used to keep.

  **CLI.** New `localterm theme` command group: `theme list` (built-ins + imports, active one marked), `theme get` (active id + name), `theme import <file>` (JSON `{name, colors}` / bare colors, or an iTerm `.itermcolors` plist → stored custom), `theme set <id>` (a built-in, `auto`, or a custom id), `theme delete <id>`. Tab-completion: `theme set` completes built-ins + `auto` + customs; `theme delete` completes customs.

  **Server.** New endpoints under `/api/themes`: `GET` (active id + custom library + an `initialized` flag), `POST /themes/import` (raw text + filename → the daemon parses with one parser shared by the browser upload and the CLI), `PUT /themes/active`, `DELETE /themes/:id`, and a one-time `POST /themes/migrate` the browser uses to push legacy `localStorage` state on first contact with an uninitialized store (ids preserved) so an upgrade never loses the user's themes.

  **Browser.** The settings hook reconciles its `localStorage` cache against the server on mount + a slow poll so a CLI `set`/`import`/`delete` reaches open tabs; import/select/delete now write through to the server. The built-in theme catalog moved to the server package (`@monotykamary/localterm-server/themes`) so the CLI, server, and UI read one source.

  **Skill.** Added `references/themes.md` and a Themes section to the localterm skill covering the CLI, the REST endpoints, import formats, and error responses.

## 2.44.1

## 2.44.0

### Minor Changes

- Per-session shell override, fish hooks, login-profile sourcing, offline fonts, custom themes/fonts, and a docs site.

  **Shells.** Pick a shell per tab (Settings → Launch → Default shell, sent as `?shell=`), per CLI/REST call (`localterm session new --shell` / `localterm exec --shell`, the `shell` field on `POST /api/sessions` + `/api/exec`; a non-executable path is rejected with `400 invalid_shell`), or globally (`LOCALTERM_SHELL`). Detection order: `LOCALTERM_SHELL` → login shell from passwd → `$SHELL` → `/bin/sh`; `GET /api/config` returns the detected default and the host's `/etc/shells` list.

  **Shell hooks.** fish now gets OSC 7 cwd tracking + git-dirty + the one-shot automation-exit hook (previously unhooked). bash mimics `bash -l` (`/etc/profile` + the first login file, `.bashrc` only when none exists → no double-source PATH duplication) and zsh sources `.zprofile`, so PATH/env set in login profiles isn't lost.

  **Themes.** 19 built-in themes (16 dark + 3 light: GitHub Light, Solarized Light, Catppuccin Latte) plus **Auto (system)**, which resolves to the dark/light default from `prefers-color-scheme` live. Import your own theme from **Settings → Theme → Import theme…** — a JSON theme (`{ name, colors }` or a bare xterm `ITheme` colors object) or an iTerm **`.itermcolors`** plist. Imported themes are stored locally, listed after the built-ins, and deletable.

  **Fonts.** All 11 fonts are now bundled (no runtime Google Fonts fetch), so the font picker works on an air-gapped or firewalled Linux VPS — only the latin woff2 subset of the selected font is fetched at runtime. A **Custom…** font entry lets you type a system-installed Nerd Font family (`JetBrainsMono Nerd Font Mono`, `MesloLGS NF`) resolved by the OS font stack.

  **Docs.** The README is now an idiot-friendly quick-start; the deep dives live in a new `docs/` tree (usage, shells, appearance, automations, auto-start, identity, pi, security, cli) with a guide to creating and importing themes. The `shell` field is documented in the agent skill.

## 2.43.0

### Minor Changes

- 2e368ca: Polish the automations UI with a ChatGPT-style prompt composer.

  **Composer.** The agent runner's prompt, model, effort, and session now live in a single rounded composer card — the prompt auto-grows and the model/effort/session selectors sit as docked pills along the bottom, a mobile-first layout that scales to desktop.

  **Form.** Settings are grouped into cards (Where & when, Limits, Secrets), the Harness config is its own nested card, the Name field is a prominent title input, and the footer is a clear action bar.

  **Schedule.** The month picker renders as a mini calendar card with uniform day tiles; weekday/day chips are rounded tiles; the time picker gains a clock glyph.

  **Detail.** The action buttons cluster into a pill toolbar and the info grid sits in a card.

  **Selectors.** Closed the stray gap between the search input and the option list in the searchable single- and multi-select popovers (model, secrets, events) by overriding the popover's default gap.

## 2.42.2

### Patch Changes

- 6e735e6: Update turbo to 2.10.3 (codemod `@turbo/codemod update`; `turbo.json` `$schema` bumped to `v2-10-3`) and silence the `no-control-regex` warnings in the ANSI/terminal-escape parsers.

  **Turbo.** `^2.10.2` → `^2.10.3`; the codemod reported no config migrations were required, only the schema URL refresh.

  **Lint.** `strip-ansi.ts`, `terminal-mode-state.ts`, and `terminal-query-responder.ts` match `\x1b` (ESC) to parse ANSI/VT, CSI/OSC, DECRQM, and Device-Attribute sequences — control characters are the entire point of the regexes. Each now scopes a targeted `eslint-disable no-control-regex` (block or next-line) with the rationale, so `pnpm lint` runs clean with zero warnings.

## 2.42.1

### Patch Changes

- 1f34d15: Reorder the automations agent-runner form so the Session (fresh/thread) picker sits below the Model and Thinking inputs, and stop the `localterm status` test from spawning real `tailscale`/`portless` subprocesses and TCP probes by mocking `resolveDaemonUrl`.

  **Form.** The agent runner's Session field now follows Model + Thinking (it previously sat between the prompt and the two pickers), keeping the per-run knobs grouped above the helper text and Harness section.

  **Test.** `tests/commands/status.test.ts` reached `resolveDaemonUrl(port)` after its mocked `fetch`, which spawns `tailscale serve status`, `portless alias`, and loopback :443 TCP probes. Under turbo's parallel load those subprocess/probe timings pushed the case past its 5s default timeout (it passed in isolation). The test now mocks the module to a deterministic loopback result, mirroring the existing `setup-portless-proxy.test.ts` pattern.

## 2.42.0

### Minor Changes

- ad1276e: Add an agent runner to automations alongside the existing shell runner, with a Triage inbox, per-run logging, a swap-ready harness abstraction, and compaction controls.

  **Runner.** An automation's `command` becomes a discriminated `runner`: `{ kind: "shell", command }` (today's PTY-tab behavior) or `{ kind: "agent", prompt, sessionMode, model?, thinking?, autoCompact?, harness? }` (runs an agent headlessly in the daemon). Agent runs come in two flavors: **fresh** (ephemeral) and **thread** (resumes one persistent session per fire).

  **Harness abstraction.** The `harness` field selects the agent implementation, so the architecture is ready to swap pi for claude/codex or a user's own harness without touching the rest of the pipeline:

  - `{ kind: "pi" }` (default): the built-in harness drives `pi --mode rpc` over JSONL. It streams a transcript log, derives the run status from the event stream (a headless API failure is "failed" even if the process exits 0), and exposes `extensions`/`skills`/`contextFiles` toggles (the `--no-*` flags) for runs whose provider extensions misbehave headless. The binary is resolved from PATH, then a login-shell fallback (`$SHELL -l -i -c` printing `$PATH`) that sources the RC adding pi's directory, and is spawned with that full PATH (minus the shims dir) so pi and its tools find their dependencies even when the daemon's own PATH is minimal.
  - `{ kind: "custom", command, compactCommand? }`: runs a user-supplied shell command in the automation's cwd with the prompt + metadata as `LOCALTERM_AGENT_*` env vars (the prompt is in env, never argv, so shell metacharacters are safe). stdout = findings; stdout+stderr = the log. `compactCommand` optionally compacts a thread session in place.

  **Compaction (thread).** Thread runs resume by default. Auto-compaction is on by default; a per-automation toggle turns it off (the pi harness sends `set_auto_compaction{enabled:false}` before the prompt). A manual "Compact now" action (detail-view button → `POST /api/automations/:id/compact`) compacts the thread's session in place (pi: a short-lived `pi --mode rpc` that sends `compact`; custom: the configured `compactCommand`).

  **Logging + history.** Run records gain `findings` (short preview) and `log`. For agent runs the log is a structured `user`/`assistant`/`tool` transcript (tools truncated; user/assistant full; thinking shown by default above each assistant response), stored as a typed array; for shell runs it's the ANSI-stripped PTY output (stdout+err) as a string; both capped at 64KB. Both the per-automation history rows and the Triage rows are a single line laid out as aligned columns (`gap-3.5`, `px-2.5 py-1.5`, fixed badge/trigger/time columns with `font-mono tabular-nums`, a flexible name column) plus a `flex-1 truncate` findings-preview column that fills the spare width. Clicking a row opens the full log on a dedicated full-pane page (back chevron + metadata + scrollable transcript). The log-page header has icon buttons to open the parent automation and, for thread runs, to open the session interactively in pi (a new terminal tab running `pi --session <file>` in the automation's cwd). The agent transcript renders as markdown (tables, bold, italics, code — headings stay pi-like: bold, no size change) via `react-markdown` + `remark-gfm`; tool entries show the tool name + its input (the path/command) and collapse their output to a 5-line preview (pi core's bash default) with an expand toggle. `unread` marks agent runs with findings. The per-run history cap is lowered from 50 to 20 (the log, not the status badge, is the storage driver now). Each run row shows an expandable "log"/"findings" view.

  **Triage inbox.** The "Recent runs" tab is Triage: a unified feed with `all`/`unread`/`failed`/`skipped` filters, an unread badge on the tab, a findings preview per row, and "Mark all read" + "Clear history" actions. While the modal is open, automations are re-fetched every few seconds as a backup to the WS broadcast, so a run that finishes flips to its final status even if the socket dropped the broadcast. Clicking a row opens a dedicated full-pane **log page** (back chevron, automation name, run metadata, scrollable log) rather than expanding inline — long logs scroll instead of crowding the list. A side button opens the parent automation. Per-automation history rows open the same log page and mark the run read (it's the same log entry as in Triage). Thread-mode agent runs show the **full session transcript** (the whole resumed branch — user / assistant / tool / compaction) read from the session file, scrolled to the latest message, instead of just the current run's log; fresh-mode runs still show the per-run log. The transcript is truncated at the clicked run's point in time (its `finishedAt`), so an older run shows the branch as it was when that run finished — not the latest state. Tool calls/results (the OpenAI `toolCall`/`toolResult` shapes the providers actually write, alongside the Anthropic `tool_use`/`tool_result` shape) are parsed and shown, colored like pi's transcript: grey for user, transparent for assistant, green for tool, purple for compaction. New endpoints: `POST /api/automations/:id/runs/:runId/read`, `POST /api/triage/mark-all-read`, `POST /api/triage/clear-history` (clears every automation's run history, keeping the automations and their run-count/lifecycle), `GET /api/agent-models` (pi's available models for the form's model selector), `GET /api/automations/:id/session?runId=` (the thread session transcript up to that run), `GET /api/agent-skills?cwd=` (discoverable pi skills for the prompt's slash-command autocomplete).

  **Migration.** The automations file migrates v3 → v4, wrapping the bare top-level `command` in a shell runner (v1/v2 records also pick up the new defaulted `findings`/`changedFiles`/`unread`/`log`). The form gains a Runner selector (Shell command vs Agent) with conditional command/prompt/session-mode/thinking inputs, a searchable single-select **Model** picker (mirroring the secrets selector; backed by `GET /api/agent-models` via pi's RPC `get_available_models` run through the localterm shim so every provider with a key registers, with a "Default" option and custom-entry on Enter). The list uses SWR (stale-while-revalidate): the cached list shows immediately and revalidates in the background each time the form opens, so it never blocks on a slow spawn but also never stays stale. The agent **prompt** input has a slash-command autocomplete for pi skills — typing `/` at the start of the prompt opens a menu of discoverable skills (filtered as you type; ↑/↓ + Enter/Tab inserts `/skill:<name> `, matching pi's own start-of-prompt expansion), backed by `GET /api/agent-skills?cwd=` which scans `~/.pi/agent/skills`, `~/.agents/skills`, and the project's `.pi/skills` + `.agents/skills` (so manual-only skills with discovery off are one keystroke to invoke). The form also has a Harness section (pi toggles or custom command + compact command), and the Close-tab-when-finished toggle is now shell-only. Auto-compaction is left to the harness default (pi: on); the per-automation toggle was removed, and existing files are repaired on load (the flag is stripped) so they keep loading. Deleting a thread-mode agent automation also removes its session file under `~/.localterm/agent-sessions/`.

  **Test stability.** Replaced fixed `wait(N)` assertions that depended on a timer firing within N ms (the SessionManager grace reaps, the watch-triggered run, the WS capacity limit, the PTY-alive-on-close) with poll-based waits (`tests/helpers/poll-for.ts`, `vi.waitFor`, event-driven `waitForSession`) so a loaded event loop waits longer instead of failing. Added a test-only reset for the model-list cache so a case can't see another's cached result.

  **Bugfix (automations vanished).** Truncation helpers sliced a log/findings text to its cap then appended a marker, so the stored value was `cap + marker.length` — over the schema's `.max(cap)`. On the next daemon start the v4 schema rejected the whole automations file and the daemon came up empty (every automation vanished). The helpers now slice below the cap by the marker length so the result fits, and the store's load repairs an existing file with oversized log/findings text in place (truncating to the cap) instead of rejecting it, recovering the user's automations and persisting the repaired form.

## 2.41.0

### Minor Changes

- bdc9e07: Add a peer keep-awake trigger to automatic mode: keep the machine awake while another client (e.g. a phone that ingested a share QR, or another tab via the session picker) is attached to a session. Held for the peer's lifetime and bypassing the activity gate, so an idle-but-attached phone doesn't release the machine to sleep mid-task. Toggle is in the keep-awake menu (default on); when its trigger is holding, the "Keep awake for peers" setting row tints to the caffeinate accent (label + switch), and the "Activity gate" row tints the same way when a gated program is holding. Preferences file migrates v3 → v4.

## 2.40.1

## 2.40.0

### Minor Changes

- Context-takeover delta compression (br-ctx): a persistent Brotli stream per client/PTY compresses each output frame against the prior screen — the delta. The prior screen primes the LZ77 window so unchanged rows compress to back-references, adding 1.24–3.7x on top of the per-frame Brotli (3.7x for a 1-row TUI update, 1.24x for a SIGWINCH re-wrap). A 200KB redraw's ~20KB per-frame drops to ~5–16KB. New 5-byte header (0x03 + 4-byte LE raw size) for context-takeover frames (the persistent DecompressionStream doesn't end per frame); the 0x00/0x01/0x02 per-frame modes keep their 1-byte header. Negotiated via a new {compress} frame before the scrollback replay; backward-compatible (old server → raw, old client → per-frame 0x02). The persistent compressor/decompressor resets on every promote.

## 2.39.0

### Minor Changes

- Application-level output compression (brotli/gzip) fixes the mobile redraw crawl. permessage-deflate is a no-op for browsers (they never advertise the extension header), so the server now compresses each binary output frame — brotli q6 if the browser can decode it, else gzip L3, else raw — with a 1-byte header (0x00 raw / 0x01 gzip / 0x02 brotli); the client decompresses via DecompressionStream. ~10x on a 64KB frame: a 200KB redraw crosses 10Mbps 5G in ~16ms instead of ~160ms (one paint, not a crawl). Backward-compatible via a `compress` capability in the {ready} handshake (old/no-support clients get raw frames); the reconnect scrollback replay goes through the same path.

## 2.38.2

### Patch Changes

- Stop the network top-to-bottom crawl on big TUI redraws over a bandwidth-limited link.

  The 2ms coalescing window was a one-shot timer set from the FIRST chunk of a burst, so a full-screen redraw of a large session (emitted as many 1024-byte node-pty data events across more than the window) flushed mid-redraw and split one logical frame across multiple WebSocket messages. Over a bandwidth-limited link each split arrives as its own atomic message and xterm paints it separately — the visible top-to-bottom crawl. The window now resets on every chunk so the flush lands 2ms after the LAST chunk of a burst, and the size cap rises 32KB -> 64KB (under xterm's 12ms parse-yield budget), so a big single redraw stays one message the browser receives atomically and renders in a single paint regardless of link bandwidth. Sustained streams never idle, so the size cap still gates their rate unchanged.

## 2.38.1

### Patch Changes

- edf6a41: Bump vite-plus dev dependency to 0.2.2.

## 2.38.0

### Minor Changes

- Add a lazy chunk builder (`buildLazyRenderChunks`) for the diff viewer: defers
  chunk construction until a visible range is requested so large diffs no longer
  block the main thread building every chunk up front before first paint. Ships
  with always-on equivalence/laziness unit tests and an env-gated stress harness
  (`STRESS_TEST=1`) benchmarking lazy vs eager at multi-million-line scale.

## 2.37.4

### Patch Changes

- 8fe3b7d: Verify a detected CDP candidate is actually live before the install/start banner reports it, so a stale `DevToolsActivePort` file left behind by a crashed or force-quit browser no longer produces a false-positive "debug-enabled browser detected" line. The banner now runs a prompt-free TCP reachability probe over the file-scan candidates — the same "first reachable candidate wins" approach the daemon's `CdpClient.establish` uses to hoist its persistent socket, but at the TCP layer so the remote-debugging consent dialog (Chrome 144+/Dia/Aside) is never fired and the daemon's single-prompt connect is preserved. Stale files point at ports nothing is listening on (ECONNREFUSED, near-instant) and are filtered out, so the banner names the browser the daemon would actually attach to.

## 2.37.3

## 2.37.2

### Patch Changes

- e2d3620: Re-sync the foreground state on WS attach so the favicon stops going stale after a daemon restart or a page refresh. The foreground watcher only emits on change, so a reattaching client never learned the current state: after a restart the icon stayed blue (a stale "process running" reading the watcher never re-emitted as null), and after a refresh it reverted to grey even with a foreground process active (green on stdout, then grey on silence because `hasForegroundProcess` was never re-seeded). The `{type:"session"}` frame now carries the current foreground-process snapshot alongside cwd/title, and the client re-seeds the favicon from it on every attach — blue for a running-but-quiet process, grey for an idle shell.

## 2.37.1

### Patch Changes

- c6602bf: Add a knip-backed `lint:dead` script and sweep unused code across the terminal,
  CLI, and server: drop the dead `@xterm/addon-canvas` devDependency, remove
  unused declarations, un-export internal-only symbols, and dedupe
  `isPortlessMissing` in the CLI.

## 2.37.0

### Minor Changes

- 84d4492: Serve shell completions from the daemon via `/api/completion` and lazy-load the
  CLI's command graph so `<Tab>` no longer spawns Node when the daemon is up
  (~210ms → ~10ms), falling back to `localterm _completion` when it's down
  (~65ms). The endpoint is auth-gated like the rest of `/api/*`.

## 2.36.0

## 2.35.2

### Patch Changes

- b1ef114: Update dev dependencies to their latest within-range versions: turbo to 2.10.2, @types/node to 26.1.0, and portless to 0.15.1.

## 2.35.1

## 2.35.0

### Minor Changes

- 479727c: In auth-gated mode (passkey/oidc), mint the daemon's own CDP viewer tabs a signed session cookie so their `/ws` upgrade passes the auth gate — without it `capture-pane --png` and real-browser `mouse` degraded to `no_browser`/SGR because those tabs carry no browser session. The cookie is minted for the session's owner (the authenticated user who triggered the capture/mouse) and set via CDP `Network.setCookie` before the tab opens; an existing live viewer tab is reused as-is (it already carries the user's cookie). Headless text capture, `exec`, `wait`, send-keys, and the SGR mouse fallback were already unaffected.
- c3caa12: Add `localterm config identity <provider>` to set the daemon's identity provider in `~/.localterm/config.json` — `none` (single authority), `header` (a proxy-set header), `passkey` (self-contained WebAuthn), or `oidc` (bring-your-own-IdP). Identity is built once at daemon start (unlike the live `cdpPort`/`graceSeconds` knobs), so the command writes the file directly and reminds the operator to `localterm restart`; it never talks to the running daemon. The existing config (`cdpPort`, `graceSeconds`) is preserved, and the merged file is validated against the daemon schema before writing. `--registration` is restricted to `open` | `closed`; `--issuer` / `--client-id` are required for `oidc`.

  Server: export `IdentityConfig` from the protocol barrel (the command validates against it).

- 4d95f3b: Add an `IdentityProvider` abstraction that resolves an authenticated identity per request, plus a `header` provider that trusts a proxy-set header (`X-Forwarded-User` by default) gated by a trusted-proxy source-IP allowlist. The session registry is now partitioned by the resolved owner; with no provider configured every request is the operator tier and behavior is byte-identical to no-auth.

  Multi-user access is enabled by adding an optional `identity` block to `~/.localterm/config.json`, so any identity-aware reverse proxy (Cloudflare Access, Pomerium, Caddy + oauth2-proxy, Authelia forward-auth) can front the daemon. A cross-tenant session probe surfaces as not-found; the operator tier (the CLI from loopback, the daemon's own CDP tabs) keeps full access. `passkey`/`oidc` providers slot in as new `IdentityProvider` variants.

- 07d60be: Add an `oidc` identity provider — bring-your-own-IdP via `oauth4webapi` (zero-dep, PKCE authorization-code flow). Any OIDC IdP (Google, GitHub, or self-hosted Authentik/Zitadel/Keycloak) authenticates; localterm keeps no passwords. A `/auth/oidc/*` login/callback/logout flow issues the same signed session cookie as `passkey`, so `identify` and the auth gate are shared. The identity is the configured userinfo claim (default `email`, falling back to `sub`); OIDC discovery is cached and retried on failure. The `redirect_uri` is the daemon's announced origin (`/auth/oidc/callback`), which must be registered with the IdP — so OIDC needs a stable announced origin (the tailnet/local-https surface), unlike `passkey` which binds to whatever origin the browser is on.

  Also adds `GET /auth/provider`, an unauthenticated meta endpoint the terminal app / CLI hit before login to learn which flow to offer (`{ provider, registration }`). `header`, `passkey`, and `oidc` now form the full `IdentityConfig` discriminated union.

- 7b01162: Add a `passkey` identity provider — localterm as its own identity authority via WebAuthn, with no external IdP or proxy. A `/auth/passkey/*` register/login/logout flow (`@simplewebauthn/server`) issues a signed HMAC session cookie that `identify` reads, so every tab after the first login re-authenticates silently. An unauthenticated request is rejected at a new auth gate (401 / WS policy-violation) rather than falling through to the operator tier — unlike `header`, there's no proxy to vouch for one. Users and credential key material persist in `~/.localterm/{users,credentials}.json`; the HMAC secret in `~/.localterm/auth-secret`.

  Enabled via the config-file `identity` block (`{ "provider": "passkey", "registration": "open" | "closed" }`). `header` and `passkey` are now a discriminated union; `oidc` (bring-your-own-IdP) is the next variant. `IdentityProvider` gains `denyUnauthenticated` and an optional `routes()` for login-flow providers. In passkey mode the CDP-driven `capture-pane --png` degrades to `no_browser` (the daemon's viewer tab has no session cookie) — headless text capture, `exec`, `wait`, send-keys, and the SGR mouse fallback all still work.

- a75f673: Add an operator bearer token so the CLI works in passkey/oidc mode, where it can't run a WebAuthn/OIDC ceremony. `localterm config identity passkey|oidc` auto-generates a token (printed once, stored in the config, preserved across re-runs; or set explicitly with `--operator-token`), and the CLI reads it from the config and sends it as `Authorization: Bearer <token>` on `/api/*` calls. The auth gate admits it as the operator tier (full access); `header`/no-provider mode is unaffected (the gate is open, and `header` has no token).

  Server: `IdentityProvider` gains `operatorToken`; the gate checks it before the session cookie.

- 5390219: Add public auth-response schemas + types for the client: `identityProviderInfoSchema` / `IdentityProviderInfo` (`GET /auth/provider` → which login flow to offer) and `authSessionSchema` / `AuthSession` (`GET /auth/<provider>/me` → the current user, or null).

  The terminal app (`@monotykamary/localterm-terminal`, not versioned) gains an `AuthGate` that probes those endpoints before mounting the terminal: a `header`/no-provider daemon or a valid session renders the terminal immediately; a `passkey` daemon with no session shows a register / sign-in screen (via `@simplewebauthn/browser`), and an `oidc` daemon shows a redirect button to `/auth/oidc/login`. The terminal only connects to `/ws` after auth, so it never 401s on the gate. A failed probe (daemon unreachable mid-load) falls through to the terminal so the existing connection UI surfaces the real error.

### Patch Changes

- 4277058: `capture-pane --png` no longer returns `no_browser` when the viewer tab's `.xterm` hasn't laid out yet: a 0-size clip falls back to a full-viewport screenshot, and an empty first capture (the tab hadn't committed a frame — the render landed just past the poll window) is retried once after a settle.
- e75e118: Tighten secret-bearing state-file permissions and the operator-token comparison. The auth-secret HMAC key (used to sign session cookies — if it leaks, anyone can forge a session), `config.json` (the operator token + OIDC clientSecret), and `secrets.json` are now written `0600` (owner-only) instead of default umask — a real leak risk on a shared host with a loose umask. The auth gate also now compares the operator bearer token with `crypto.timingSafeEqual` instead of plain `===`, removing a byte-by-byte timing leak against a network-reachable daemon.

## 2.34.0

### Minor Changes

- c1e4494: Keep-awake (the coffee button), its battery floor, and the chrome://inspect bootstrap now work on Linux as well as macOS.

  - Keep-awake on Linux uses `systemd-inhibit --what=idle:sleep:handle-lid-switch --mode=block tail -f /dev/null` instead of `caffeinate -dims`. The spawned `systemd-inhibit` runs detached in its own process group so a group-kill releases the inhibitor and reaps the orphaned `tail` cleanly — the lock is tied to `systemd-inhibit`'s D-Bus lifetime, so killing it always releases the assertion. Support is gated on `systemd-inhibit` being on PATH, so the coffee button hides on non-systemd/minimal hosts instead of spawning a no-op. `tail -f /dev/null` is the portable blocker (coreutils + busybox; `sleep infinity` is GNU-coreutils-only).
  - The battery floor now reads `/sys/class/power_supply/<dev>/{type,capacity,status,time_to_empty_now}` on Linux (no `upower`/`acpi` dependency), gating on `type === "Battery"`; `pmset -g batt` stays the macOS path. Both fail-open to `null` so a desktop or a transient read error never wedges keep-awake off.
  - The "Inspect" button's chrome://inspect launcher on Linux invokes the detected browser binary directly (`google-chrome`, `chromium`, `brave-browser`, …) with the URL — `xdg-open` has no `chrome://` scheme handler, so the prior OS-opener fallback was a silent no-op. A running Chromium reuses its instance's profile and opens a new tab, matching what the macOS AppleScript achieves. Priority order matches the DevToolsActivePort scan.

## 2.33.0

### Minor Changes

- 8662aca: The Settings → Automation browser section is now the first section, and the settings gear shows an amber badge while CDP status is known-disconnected.

  Added an "Inspect" button next to Connect that opens `chrome://inspect` in the user's browser. This is the bootstrap path for users who haven't enabled remote debugging yet — they open the inspect page to toggle "Discover network targets" — so it deliberately does **not** use CDP (CDP isn't available to those users). `chrome://` URLs can't be navigated to from a web page and have no registered OS URL-scheme handler, so the button hits a new `POST /api/cdp/open-inspect` daemon route. On macOS the daemon runs an AppleScript that detects the running Chromium app dynamically (preferring the frontmost one — the browser the user is viewing localterm in — falling back to the first running candidate from the existing browser list) and sends it an `open location "chrome://inspect/#remote-debugging"` event, which reuses the running profile and avoids the profile picker. No browser is assumed or hardcoded; elsewhere the OS opener is used as a best-effort fallback.

- e5818c4: Detect `gh` (GitHub CLI) invocations event-driven, without polling, and use the signal to auto-refresh the current branch's PR lease.

  The keep-awake process-tree walker is the wrong tool for short-lived CLIs like `gh` — they exit before a `ps` snapshot can observe them. So `gh` is now a built-in **activity-watched** program: the daemon generates a `gh` PATH shim (in `~/.localterm/shims`, alongside the secret shims) that runs the real binary as a child, then overwrites `~/.localterm/activity/gh` with the shell's `$PWD` after it exits. A new `ProcessActivityWatcher` keeps one `fs.watch` on that dir (no timer) and emits a per-cwd-debounced `activity` event on each write.

  - The signal fires **after** `gh` completes (the shim captures the exit code, signals best-effort, then `exit $_rc`), so consumers read post-command state — e.g. `gh pr merge` has already changed the PR before the refresh runs. Secret-only programs keep `exec` (unchanged); only activity-watched programs run as a child.
  - The activity shim is generated even with no secrets configured (no secret needed for `gh` — it has its own auth), so detection is on by default. If `gh` is also a secret process, the shim merges: resolve the secret(s), then run + signal.
  - The one wired consumer: on a `gh` activity event, the daemon refreshes the PR lease for that cwd (`getGitBranchPr` + `broadcastGitBranchPr`) — but only when a coordinator exists for it (a tab is viewing the repo), so a `gh` run in an unviewed directory never triggers a pointless GitHub API call. This is the role the working-tree `git-dirty` signal plays for the diff summary, but for remote GitHub state the working tree never reflects.
  - `SessionManager.hasCoordinatorFor(cwd)` exposes the subscriber check (mirrors `broadcastGitBranchPr`'s non-creating philosophy).
  - Built-in activity-watched set is `ACTIVITY_WATCHED_PROGRAMS` in `constants.ts` (currently `["gh"]`); add programs there to extend. The signal is darwin-only for now, gated on the secret backend (the shim feature is darwin-only); elsewhere no shim is generated and the watcher has nothing to watch.

## 2.32.0

### Minor Changes

- Terminal-use parity: `press` (named keys), `wait` (block until the pane matches), `capture --png` (screenshot via the browser over the daemon's existing CDP socket), and `mouse` (click/drag/move/scroll — by coords or `--on-text`), so an agent can drive mouse-first TUIs (NetHack, dialog installers, `mc`) headlessly.

  - **press**: `localterm session press <id> F2` / `press Ctrl-C` / `press Escape : w q Enter` — named keys resolved server-side to xterm bytes (unknown tokens pass through as literal text). REST: `POST /api/sessions/:id/input` with `named:true`.
  - **wait**: block until the rendered pane matches `--text`/`--regex` or goes `--idle`, bounded by `--timeout` — the primitive for interactive apps so an agent doesn't poll. Reuses the tmux-parity capture renderer (flushed per frame) as the source of truth. REST: `POST /api/sessions/:id/wait`.
  - **capture --png**: rasterize the pane to a PNG via the browser over the daemon's one persistent CDP socket (the browser is the rasterizer — no new image dep). Reuses a live viewer tab when one exists; otherwise opens an ephemeral background tab, waits for xterm to render (content-equality against the server-side capture renderer — can't return stale pixels), screenshots the `.xterm` element, and closes it. Pinned sessions survive between calls with no tab burning a slot. `409 {error:"no_browser"}` when no browser is reachable (text `capture-pane` still works headlessly). REST: `GET /api/sessions/:id/pane?format=png`.
  - **mouse**: dispatch a real mouse event through the tab's xterm.js (SGR generated natively — exact drag/scroll/click-count semantics with no encoder) over CDP; falls back to direct SGR-1006 bytes written to the PTY when no browser is reachable (true headless), gated on the session's mouse-tracking mode so bytes are never fed to an app that didn't enable mouse. `--on-text` resolves a label's coords on the server-side capture grid (no tab needed). REST: `POST /api/sessions/:id/mouse` + `GET /api/sessions/:id/mouse/state`. CLI: `localterm session mouse {click,drag,move,scroll,state}`.
  - Every CDP call reuses the daemon's existing persistent socket (`ctx.cdpClient`) — no second connection, no per-call reconnect.

## 2.31.0

### Minor Changes

- 32f75fe: Add programmatic PTY control (tmux parity) over the REST API and the `localterm session` CLI, plus `exec` — the synchronous command+output+exit-code primitive for AI agents.

  - **Sessions**: `POST /api/sessions` (spawn a detached, pinned-by-default PTY), `GET/PATCH /api/sessions/:id` (rename/pin), `POST /api/sessions/:id/{input,resize,exec}`, `GET /api/sessions/:id/pane` (capture-pane), `DELETE /api/sessions/:id` (existing). CLI: `localterm session ls|new|attach|kill|send-keys|capture|exec|resize|rename|pin|unpin`.
  - **exec**: one-shot `POST /api/exec` / `localterm exec` (transient shell, run+capture+exit) and in-session `POST /api/sessions/:id/exec` (stateful — cwd/env/history persist across calls). Returns `{exitCode, output, timedOut, truncated, durationMs}`; the CLI propagates the exit code (text mode) or emits JSON (exits 0, code in the payload).
  - **Pinned sessions**: REST-created sessions are exempt from the idle reap and from silent eviction at the session cap, so an agent's shell survives between calls. Browser tabs keep the grace window. `--no-pin` / `pinned:false` opt out.
  - **Server-side terminal emulation**: a lazy per-session `@xterm/headless` renderer (same parser as the browser) feeds `capture-pane` and exec clean, ANSI-processed text. Loaded via `createRequire` to work around the package's missing `exports` field.
  - **Skills**: a new `references/sessions-exec.md` reference plus an updated `SKILL.md` so LLMs can drive the surface.

## 2.30.0

### Minor Changes

- 28feb59: Add a configurable no-clients grace period (Settings → Sessions → Grace period), with an "Off" option to never reap.

  The 30s window a shell with no viewers stayed alive after its tab closed was a hardcoded constant (`SESSION_GRACE_MS`). It's now a daemon-global setting in `~/.localterm/config.json` (`graceSeconds`), edited through the same `GET`/`PUT /api/config` path as the CDP port and hydrated into the Settings modal on open.

  - `graceSeconds` is in seconds. `null` (empty field, "Off") parks a dormant shell with no timer so it lingers until killed from the session switcher or evicted at the session cap; `0` reaps an idle shell the moment its last viewer detaches; a finite value keeps the existing behavior. A shell still running a command is never reaped regardless of the window — only a truly idle one dies within it. Bounds are 0–3600s, default 30s.
  - A `PUT` re-arms every already-dormant session's grace timer via a new `SessionManager.rearmGrace()`, so a change takes effect immediately rather than only on the next detach. The manager reads the live value at each arm instead of capturing it at construction.
  - The terminal Settings modal gains a "Sessions" section (after "Launch") with a numeric field and an explanatory tooltip. The commit-on-blur numeric input is extracted from the CDP port field into a shared `ConfigNumberField` so both daemon-global knobs reuse it.

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

## 2.28.2

### Patch Changes

- 6b28952: Reflow the local grid to the PTY's effective cols so the dead columns carry no stale content, keeping the mask.

  The viewport mask sat over xterm's canvas, and the wider local grid retained the lines the PTY streamed at the old width before a narrower peer joined — scrollback isn't reflowed when the PTY shrinks — so on the desktop those stale wide lines (a model list, a long prompt) bled through the mask's wash. On the phone, the active/limiting viewer, the grid already matched the effective size and reflowed, so the same content wrapped and there was nothing to bleed.

  The client now clamps its xterm grid to the effective cols (the min across clients) on every `pty-size` frame, so xterm reflows the whole buffer to the effective width and the dead columns become empty page background. The screen is left-aligned so the live viewport stays at the left and the mask covers the right gutter as before; the grid keeps the local natural row height so the terminal stays full-height. The server is still told the viewer's NATURAL cols (not the clamped grid) — the min-across-clients needs each viewer's real size so a wider viewer can grow the PTY back when the narrowing peer leaves; reporting the clamped size would deadlock it at the narrow width.

## 2.28.1

### Patch Changes

- dd27c3f: Mask the dead area beyond a peer-constrained PTY viewport as inactive chrome.

  A PTY is resized tmux-style to the min cols/rows across every attached client, so
  when a phone (≈40 cols) joins a desktop (≈120 cols) the PTY streams into a 40-col
  region while the desktop's wider xterm fills the remaining ~80 columns with empty
  terminal background — indistinguishable from usable space, with nothing conveying
  that the _active_ viewport is the phone's.

  The server never told any client what the effective size was: the only size message
  in the protocol was client→server (`resize`), and the `session` frame carries no
  cols/rows. So the desktop had no idea the live region ended 80 columns ago.

  The server now broadcasts a `pty-size` frame (the min cols/rows across clients)
  whenever that min changes — on a peer attach/detach, or any client resize — and
  seeds a joiner that enters an already-constrained session without changing the min.
  A lone viewer is never constrained (its effective size always equals its own), so
  it's left quiet except for one clear frame when a peer detaches and drops it back
  to solo, which erases the mask the leaving peer had imposed.

  The terminal masks the dead columns beyond the effective width as a single full-height band
  flush to the surface's top, right, and bottom, with the configured horizontal padding as
  the gap on its left (from the live viewport's right edge). Only the vertical boundary is
  masked — the horizontal one conveys nothing the vertical doesn't, and a phone with the
  keyboard down is often taller than the desktop (so the desktop is the row-limiter) and
  masking the phone's own bottom read as a bleed and wasted its limited vertical space. The
  mask is gated on the local grid being wider than the effective size (a col count, not a
  pixel sliver, so sub-pixel rounding from xterm's centered screen never renders a phantom
  line on the limiting viewer). It is null — nothing rendered — when the local grid already
  matches the effective size (sole/limiting viewer, no constraining peer) or the terminal
  isn't measurable yet, and it's cleared on every session frame so a switch never inherits
  the prior PTY's mask.

## 2.28.0

## 2.27.4

### Patch Changes

- 6258fb9: Propagate a refreshed PR lease to every PTY sharing the same directory.

  The ambient PR indicator was a per-tab pull lease: each PTY fetched its own PR
  from `/api/git/branches/pr` and held it in local state, so a remote state change
  one tab observed never reached its siblings. Two PTYs in the same cwd could
  diverge — one "merged" (after a manual refresh) and one still "open" — because a
  merge on GitHub produces no local git-dirty signal for the other tab to refetch
  from. The git-dirty front already shared this (the per-cwd coordinator
  broadcasts the diff summary to every subscribed tab); only the PR front didn't.

  The per-cwd coordinator now also broadcasts a `git-branch-pr` message to every
  subscribed tab when the endpoint recomputes the PR, so a refresh on one tab
  converges its siblings. The PR is deliberately not replayed on subscribe: with
  no local signal refreshing it, a cached value can be arbitrarily stale, and
  replaying it would race a tab's own freshly-fetched lease — each tab still
  populates its initial PR from its own HTTP fetch and converges via the pushes.

## 2.27.3

### Patch Changes

- 1728fd6: Fix the ambient PR indicator never showing for a same-repo branch, and for partial/blobless clones.

  **Same-repo PRs (the primary bug).** PR detection queried the GitHub REST `pulls.list` with `head=owner:branch`, but that `head` form only matches _fork_ PRs — for a same-repo PR (the common case where you push to `origin` directly) it returns 0 results, and a bare branch name is silently ignored (returns all PRs). So a branch with an open PR against its own origin repo was never detected and the toolbar PR indicator never appeared, while fork PRs worked. The fetcher now uses a GraphQL `pullRequests(headRefName:)` query — the same semantics `gh pr list --head` uses — which filters by branch name across same-repo and fork PRs alike. The `headRepositoryOwner === origin owner` filter is retained so a stranger's same-named fork PR can't claim a common branch like `main`. GraphQL also returns `mergeable` in the same query, so the per-PR detail round-trip is gone.

  **Partial/blobless clones.** `parseGithubRemotes` matched each `git remote -v` fetch line with `/^(\S+)\t(.+?)\s+\(fetch\)$/`, anchoring `(fetch)` to the end of the line. A partial clone (e.g. `git clone --filter=blob:none`) annotates the fetch line with the filter spec — `origin\t<url> (fetch) [blob:none]` — so the trailing ` [blob:none]` broke the anchor, no remote matched, and PR detection silently no-op'd on partial clones. The regex now tolerates the optional trailing filter annotation (`[blob:none]`, `[tree:0]`, `[blob:limit=1m]`, …).

## 2.27.2

### Patch Changes

- Internal: extract the `/api` route tree out of `createServer` into a `buildApiRoutes(ctx)` builder (threading a `DaemonContext`), and apply style nits (arrow functions in browser detection, explicit boolean checks in the network policy). No public API change.

## 2.27.1

### Patch Changes

- e93c493: Reap empty project folders left in `~/.localterm/worktrees/` after a stale worktree is swept. `git worktree remove` deletes the worktree but leaves its `~/.localterm/worktrees/<project>/` folder holding only the `.localterm-repo-id` marker; the sweep now removes that folder once it's empty (never when a sibling worktree or any other file remains), so the shared dir no longer accumulates dead project folders.

## 2.27.0

### Minor Changes

- 727c493: Flip secret injection from secret-centric to process-centric, mirroring the automations multi-select flow.

  Secrets used to carry the binaries they shims (`secret = { name, envVar, programs[] }`), so you assigned programs per secret. Now a secret is just an identity + the env var it exports (`{ name, envVar }`), and a **process** is a binary that names which secrets it receives (`{ name, requestedSecrets[] }`) — the same multi-select model automations already use for `requestedSecrets`. The shim generator now reads processes directly (no inversion): one shim per process, baking each requested secret's `envVar` from the store.

  **Cascade parity (the automations path was missing this):** deleting a secret now strips its name from every automation's and process's `requestedSecrets`, regenerates shims, and re-broadcasts automations — so no container keeps a dangling name a run/shim would silently skip. `removeSecretFromAll` was added to both `AutomationStore` and `ProcessStore`.

  **One-time in-place migration:** a v1 `secrets.json` (with `programs`) is rewritten to v2 (stripped) plus a new `processes.json` built by inverting `programs` — a program listed by several secrets becomes one process requesting all of them. Runs once at startup before the stores load; idempotent; invalid program names are dropped with a warning so it never writes an un-loadable file. No backwards compatibility is kept — the stores only know the new shapes.

  **REST surface:** `GET/PUT/DELETE /api/processes/:name` (`PUT` body `{ requestedSecrets }`, rejects unknown names with `invalid_secret`); secrets routes dropped `programs`. **CLI:** `localterm process list|set <name> [-s a,b]|delete`, and `localterm secret set` lost `-p/--programs` (use `process set` to wire binaries). **UI:** the secrets modal gains a Processes tab (Secrets ⇄ Processes, the automations tab pattern) with the same `SecretSelector` multi-select; the standalone processes menu entry is gone. Secret and process names are now immutable (a rename would silently disconnect cascade wiring — delete and recreate to rename); `envVar` stays editable.

  Also fixes the secrets modal showing only one row on first open: it used a fragile `scrollHeight - getTotalSize()` measurement that under-sized the body before rows measured. Dropped for the worktrees pattern (list div sized directly from `getTotalSize()`).

## 2.26.1

## 2.26.0

### Minor Changes

- b967c44: Let an automation request exactly the secrets it needs, resolved into the run's PTY env at spawn — never over HTTP.

  Automations type an arbitrary shell `command` into a tab, so a secret in that tab's env can be exfiltrated. Exposure is now **per-automation, opt-in, and least-privilege**: each automation carries a `requestedSecrets: string[]` (secret **names**, the stable identifier — not env vars) and defaults to `[]`, so an automation gets exactly the secrets it named and nothing else. A command alone can never reach a key the automation didn't explicitly request; the request list is a second, visible, auditable gate on top of the command.

  Resolution happens at **launch time**, not claim time: when a run fires (schedule / watch / event / webhook / manual), the daemon resolves each named secret from the Keychain in parallel and stores the env on the pending run _before_ it opens the run tab. The WS that claims the run is therefore guaranteed to see the resolved env, and the synchronous `onOpen` spawn path just passes it through to the PTY. Resolution is fail-closed on both ends: unknown names are rejected at create/update with `400 {"error":"invalid_secret"}` (catches typos), and a name deleted after the automation was authored — or a secret with no value (locked Keychain / never set) — is silently skipped at run time rather than clobbering a pre-existing env var with an empty string.

  The "values never cross the HTTP surface" property is unchanged: the value goes Keychain → daemon → PTY env, so the network-origin gate on `/api/*` is not widened. The env lives only in the run's shell process (and its children, e.g. `node scripts/update-models.js`), not the parent daemon or any other tab. The secrets store, schema, REST, and secrets modal are untouched — the field lives entirely on the automation.

  The automations file is forward-compatible: `requestedSecrets` defaults to `[]` in the stored shape, so existing v3 files load unchanged and v1/v2 migrations synthesize `[]`. The terminal's automations modal gains a "Secrets to expose" section (one switch per secret, with its env var) so you select per-automation from the secrets you've already configured; the create/update REST input schemas accept the field and the wire response carries it via the existing `automationWithNextRunSchema` spread.

## 2.25.1

### Patch Changes

- 6d8102e: Auto-close the desktop's share-QR modal once a mobile ingests it.

  When a mobile device scans the desktop's share QR (or another tab joins via the session picker), the daemon now broadcasts a `peer-attached` control frame to the PTY's existing subscribers at attach time — before the joiner is added, so it isn't told about itself, and skipped on a fresh spawn's first attach (no peers to notify). The frame carries no payload: the recipients are, by construction, already attached to the session a peer joined.

  The terminal's QR modal registers a handler while open that closes itself on `peer-attached`, but only in share mode — ingest is this tab scanning someone else's QR, so a peer joining our own session is unrelated to that and the scan stays uninterrupted. Before this the share QR stayed on screen after the handoff was already complete, so the desktop kept showing a live QR for a session it had just handed off.

- 9f6135e: Hide the worktree trash action while a shell is still open in the worktree, instead of offering a delete the server would refuse.

  The earlier active-PTY guard only armed the `DELETE /api/git/worktrees` route — it returns `409 active_pty` when any session's current cwd is inside the target worktree (attached, dormant in the no-clients grace window, or running an automation), and the stale-worktree sweep skips a shell-occupied worktree for the same reason. But the worktree **list** response carried no signal about which worktrees have live shells, so the modal always rendered the trash icon for any non-main / non-current worktree. A user could arm + confirm a delete that the server then refused with a 409, and — exactly as reported — the icon "appeared" for worktrees that did have a PTY sitting in them.

  The fix makes the list expose the same signal the guard already trusts: each worktree now carries `activeSessionCount`, computed in the `GET /git/worktrees` route via `registry.sessionsInPath(path).length` — the exact call the delete route and the sweep use — so the UI's "can I delete this?" and the route's "will I allow it?" can never disagree. The modal hides the trash button when `activeSessionCount > 0` (the "open in new shell" / "open in…" buttons stay, so you can still open more shells there) and shows a count-aware blue **"in use"** badge ("in use" / "2 in use") with a "close them first to remove" tooltip, gated to `!isMain && !isCurrent` so its promise is only shown where it's true. The modal now polls the worktree list while open (`WORKTREES_POLL_INTERVAL_MS = 2000`, mirroring the sessions modal) so the badge and trash reflect a shell opened from the modal's own "open in new shell" button, a parked (closed-tab) PTY, or a kill from the session picker; the poll is silent so a transient daemon blip can't swap a good list for the error block. `listGitWorktrees` takes the counter as an optional callback (default `() => 0`) so the pure function stays unit-testable without a registry.

## 2.25.0

### Minor Changes

- 39a60f1: Add a per-program secret manager (Settings → Secrets) that stores API keys in the macOS Keychain and injects them only into the programs you list, via PATH shims — so `ls` in the same tab never sees your `ANTHROPIC_API_KEY`.

  The motivation is the agentic-coding pattern of pasting API keys into `~/.zshrc` (or a sourced `~/.tune/.env`) in plaintext, where every shell — and every file-reading AI agent — gets every key. localterm now owns this itself: a modal (Settings → Secrets) manages a policy of `{ name, envVar, programs }` entries (names only — values never leave the Keychain and never return to the browser after you save). The daemon generates a self-contained POSIX shim per program in `~/.localterm/shims` that resolves the secret(s) and `exec`s the real binary, and localterm's zsh/bash shell hook prepends the shims dir to `PATH` **after** the user's rc files run — so the shims reliably shadow the real binaries despite rc PATH manipulation (`export PATH=/opt/homebrew/bin:$PATH`), the failure mode of a naive daemon-time PATH entry. The secret exists only in the shimmed program's process (per-process scoping), not the parent shell, matching the "which programs have access" model.

  Values are never served over the daemon's HTTP `/api/*` surface: that surface is gated by a network-origin check (loopback/tailnet), not a capability check, so a `GET /api/secrets/:name` returning a value would be readable by any local process via `curl`. Instead, value resolution happens only in the shim at exec time, via the macOS `security` CLI (the same path the existing GitHub-token resolver uses). The HTTP routes carry names + the policy + a `hasValue` flag (probed from the Keychain without reading the value into memory) — enough for the UI to manage secrets without ever exposing them. Writes use `security add-generic-password -w <value>`, which passes the value as a CLI arg briefly visible to `ps` for the ~ms the `security` process lives — the standard `security`-CLI trade-off (it has no stdin path for the password); the value never touches disk.

  The backend is an interface (`SecretBackend`), so the macOS Keychain implementation can be swapped for an encrypted-file backend (non-darwin, no Keychain) without touching the store, routes, or shim generator — the generator bakes the backend's resolution snippet into each shim. Only the Keychain backend ships in this release; the daemon reports `supported: false` and the UI shows a banner on platforms without it.

  Secrets are also manageable from the terminal via `localterm secret list|get|set|delete`. `get` resolves the value from the Keychain directly (not through the daemon's HTTP API — preserving the "values never cross the network" property, and working with the daemon down), while `list`/`set`/`delete` go through the daemon's REST API. `set -v -` reads the value from stdin for the no-argv-exposure path. A `secrets-sessions.md` reference documents both the secrets and sessions REST surfaces (including the security model and the shim mechanism) and is linked from the `localterm` skill.

- Settings is now a centered modal instead of a cramped toolbar popover, giving dense controls real room and making the long list of sections (theme, font, window, launch, notifications, cursor, typing, scrollback, shell) comfortable to scroll and tap on a phone. The panel is `w-[480px]` capped to `max-w-[calc(100vw-2rem)]` with a height-capped scrollable body, fades/scales in like the other palette overlays, and the terminal sits behind a backdrop while it's open.

  This also retires a mobile bug: dropdowns (theme, font, cursor, scrollback selects) floated over the tappable terminal inside the old popover, so tapping outside a select to close it hit the terminal's touch handler and popped the on-screen keyboard. Inside the modal there's no terminal surface to mis-route a dismiss tap onto, and the programmatic refocus after an overlay closes no longer un-guards the helper textarea on touch — so the keyboard stays closed when you're just dismissing a dropdown.

  The Secrets modal now animates its body in (height-reserved + fade, matching ports/sessions/worktrees) instead of flashing a centered spinner that swaps for the list, and its trash icon follows the worktrees modal's two-tap armed-delete pattern (tap to arm → red icon → tap again to confirm).

## 2.24.0

### Patch Changes

- 7ed7675: Stop zsh's `PROMPT_SP` from leaking the EOL mark (`%`) and fill-to-end-of-line spaces (blank lines) above the prompt on mobile.

  zsh's `PROMPT_SP` (on by default) prints, before each prompt when the prior line had no trailing newline, the `PROMPT_EOL_MARK` (`%B%S%%%s%b` — a bold + reverse-video `%`, the "white-background %") **and** a fill-to-end-of-line space burst, then zle's redraw erases both. localterm's precmd/chpwd hooks emit OSC sequences (git-dirty, osc7) with no trailing newline, so `PROMPT_SP` fires on every prompt.

  localterm resizes xterm **before** the server's PTY catches up — the client shrinks xterm to the new viewport immediately, then sends the resize, which round-trips over a DERP-relayed tailnet at 200–400ms plus a debounce. During that window xterm is narrower than the PTY. At spawn the gap is widest: the PTY starts at the wide `DEFAULT_COLS` (120) while the mobile xterm is still its narrow phone viewport (often ~40 cols). If the shell redraws in the gap — a SIGWINCH from a prior resize landing, a prompt cycle, or the first prompt at startup — the mark and the fill spaces (sized for the wider PTY) wrap in the narrower xterm, so zle's `clear-to-end-of-screen` erases from the wrapped line down and leaves the mark as a stray `%` and the fill spaces as a blank line above the new prompt:

  ```
  $ %
  $
  ```

  …or, once the visible mark is gone, just the blank line:

  ```

  $
  $
  ```

  This is why it only appeared on the phone (the virtual keyboard triggers frequent viewport shrinks; spawn starts the PTY wide while xterm is narrow), only on new PTYs / intermittently (only when a shell redraw coincides with the mismatch), and was reduced-but-not-eliminated by predictive-typing-off (its cursor manipulation widened the desync window, but the core width-mismatch leak remained). On the macbook the width never rapidly diverges, so the erase always landed and neither artifact was ever visible. An earlier attempt emptied `PROMPT_EOL_MARK`, which removed the visible `%` but left the fill-to-EOL spaces — which wrap the same way and produce the blank line. The fill spaces are not independently configurable, so the complete fix disables `PROMPT_SP` entirely: neither the mark nor the spaces are emitted, so nothing can wrap and leak.

  The cost is the standard non-zsh behavior (what bash/sh already do): a command whose output genuinely lacks a trailing newline gets the next prompt on the same line instead of a fresh one. That's acceptable here — the only unterminated output in this setup is localterm's own OSC hooks, which are invisible (consumed by xterm as escape sequences, no visible chars, no cursor move), so the prompt still starts cleanly after newline-terminated output (the common case). Set after the user's `.zshrc` is sourced so it overrides any user setting. The bash hook is unaffected (bash has no `PROMPT_SP` equivalent). No effect on the macbook: the artifacts were erased correctly there anyway, so nothing changes there.

## 2.23.1

## 2.23.0

## 2.22.0

### Minor Changes

- Add an open dev-ports modal that shows the TCP listening sockets a session's shell has open (a dev server run inside a tab) and lets you stop one without leaving the terminal.

  Server side, two new routes. `GET /ports` walks the process tree under each session shell (`ps`) and the listening socket table (`lsof -nP -iTCP -sTCP:LISTEN`), then returns the ports that descend from a live session — each row carries the owning pid/process name and the session's id/title/cwd so the modal can badge it without a second fetch. `DELETE /ports/:pid` stops a dev server by `SIGTERM`-ing the owning pid; it re-verifies the pid still descends from a live session against a fresh snapshot before signalling, so a pid recycled after the dev server exited (the shell spawned an unrelated process that reused the number) can't be killed by a stale request. Both snapshots are injectable via `ServerOptions` (`portsSnapshotProcesses` / `portsSnapshotListeners`) so tests can drive the list deterministically without a real listener; the tree snapshot defaults to the same shared `ps` read keep-awake's automatic mode uses.

  Terminal side, a `PortsButton` in the toolbar and a `PortsModal` that polls the list while open (so a server starting/stopping shows up live). Each row is the port number (bold mono) as the identity, the owning session's title/path taking the flex-1 truncation slack, the process name + bind address right-aligned in a mono meta column (hidden on mobile so the row stays a one-liner on a phone), and an always-visible stop button trailing. The row itself is informational — stopping a dev server is an explicit, deliberate action via the stop button (or Enter on the highlighted row) so an accidental tap never kills a running server. The stop button is always shown, not hover-gated like the sessions modal's kill X, because a touch device has no hover to reveal it and stopping a dev server is this modal's whole purpose. Wired into the command palette as "Dev ports" with a Network icon.

- Block worktree deletion while a PTY is still active on it, so `git worktree remove` can't pull the directory out from under a live shell.

  A live PTY — attached, dormant in the no-clients grace window, or running an automation — holds the worktree as its cwd; removing the worktree out from under it would break the shell. The `DELETE /worktrees` route now refuses with `409 active_pty` (and a count-aware message) when any session's current cwd is inside the target worktree, and the stale-worktree sweep skips a shell-occupied worktree for the same reason. The signal is the session's _current_ cwd (last emitted, falling back to the spawn cwd), read via a new `SessionManager.sessionsInPath(targetPath)` helper, so a shell that's `cd`'d out of the worktree no longer blocks removal. The sweep's busy check runs before the git cleanliness spawn since it's an in-memory lookup.

## 2.21.0

## 2.20.2

### Patch Changes

- 16f28b7: Fix orphaned idle PTYs that never reap when the shell aliases its process name.

  On macOS `/bin/sh` is bash (GNU bash 3.2 in sh-mode), which overrides its kernel process name at startup so node-pty's `pty.process` reports `"bash"` for an idle `/bin/sh` while the invoked basename is `"sh"`. The no-clients grace reap compared `pty.process` only against the invoked basename, so an idle `/bin/sh` was misreported as a running foreground program — `computeState` read `"alive-quiet"` forever and the grace timer rescheduled indefinitely. A closed `/bin/sh` tab (or any shell whose reported name differs from the invoked basename) sat dormant and was never reaped: the exact "orphaned PTYs that have nothing in them don't clear" symptom.

  The foreground check now disambiguates with the terminal's foreground process group instead of the process name: the shell is its own process-group leader holding the terminal at idle (`tcgetpgrp == pty.pid`), while a foreground program runs in its own group (`tcgetpgrp != pty.pid`). When `tpgid` confirms the shell is idle, the current `pty.process` reading is recognized as the shell's alias name and learned (cached per shell path, so the one `ps -o tpgid=` runs at most once per aliased path per process lifetime). This is name-agnostic — no proctitle-timing race, no polling a short-lived session could poison — and a genuine foreground program (a child, different pid/group) is still reported as foreground, so the "keep a dormant PTY alive while a foreground program runs quietly" guarantee is preserved. Non-aliased shells (zsh/bash) never mismatch and never run the check; Linux reads `/proc/<pgrp>/cmdline` (the invoked name, already matched), so the fix is macOS-scoped.

## 2.20.1

## 2.20.0

## 2.19.0

## 2.18.0

### Patch Changes

- faff5ca: Fix the blank git ambient overlay on mobile and two mobile layout overflows in the diff viewer and automations modal.

  The ambient git-diff/PR overlay sometimes stayed blank on mobile while pi made changes, only recovering after a session switch back and forth. The per-cwd `GitDirtyCoordinator` only pushed a `git-diff-summary` when a `git-dirty` signal fired _after_ a client subscribed — there was no initial push on attach. So a freshly-attached tab (page load, reconnect, or a reattach whose fan-out already completed) never learned the current summary until the next `git-dirty` signal; on a flaky DERP-relayed link the user saw a blank overlay until a session switch's resize/prompt-redraw fired a `git-dirty`. The coordinator now caches the last computed summary and replays it to a new subscriber on `add` (the first subscriber with no cached summary triggers a fresh compute). The replay reuses the cache instead of invalidating, so a reattach no longer thrashes the diff viewer's per-file patch cache.

  The automations modal's collapsed sidebar row kept the sort buttons (last-run / created / name) next to the select when the screen narrowed, but they don't fit on a phone. The row now drops them when collapsed — the select stays (and grows to fill the row, truncating long names) — and the sort/search controls remain available in the expanded sidebar. The select popover keeps its own search.

  The diff viewer's selected-file row didn't truncate the file path: the path container lacked `min-w-0`, so a flex item wouldn't shrink below its content and `truncate` never engaged — long paths overflowed and pushed the external-link button and the +/- stats off-screen, and when truncation did engage it cut the tail (the basename) and showed the head. The path container now shrinks (`min-w-0 flex-1`) and the path is tail-truncated using the same `dir="rtl"` + `<bdi>` split the file-list popover already uses: the directory renders muted and the basename in the foreground, and when it overflows the head (directory) is cut with an ellipsis so the tail (basename) always stays visible. The dropdown trigger mirrors the popover rows (muted directory + foreground basename), and the rename display keeps the new path's tail visible. Tail-truncation is done in CSS (the browser's own layout engine, pixel-accurate against the user's chosen mono font) rather than measured with pretext, whose hardcoded font string wouldn't match a custom font.

- 3eb93e0: Fix the blank-screen-on-refresh mobile regression and route automation run tabs at the daemon-local surface.

  A freshly-attached WS client stays "pending" for `SESSION_PENDING_PROMOTE_TIMEOUT_MS` until it sends `{ready, replay}`, then the server flushes its scrollback replay + buffered output. The timeout was 100ms — shorter than a mobile/tailscale round-trip (often DERP-relayed at 200–400ms). The auto-promote fired before the client's `{ready, replay: true}` arrived, and since the auto-promote skips the scrollback it never sent the `replay-end` the client had already opened its suppressed-replay window for — so every output frame buffered client-side in `replayChunks` and never rendered, leaving a blank screen with a blinking cursor only a session-picker switch could recover. The timeout now clears a flaky relayed tailnet with room to spare (2s), and `promote` always sends `replay-end` (even on `replay: false`) so a slow link can never deadlock the client in its replay window. The timeout is injectable for tests.

  Automation run tabs opened at the announced `publicUrl`, which `resolveDaemonUrl` picks tailnet-first — so a tailnet-fronted daemon opened run tabs at `https://<node>.ts.net`. Run tabs open in the daemon's own debugged browser, where a flapping `tailscale serve` (laptop wake, DERP relay, cert renewal) fails the tab load, the PTY never spawns, and the automation fails. The CLI now resolves a separate daemon-local `localUrl` (portless `https://localterm.localhost`, else loopback) and hands it to the server via a new `localUrl` option / `RunningServer.setLocalUrl`; `tryLaunch` opens run tabs at the local surface, and `isLocaltermTabUrl` recognises it so ambient-token injection and `closeOnFinish` keep working on the portless run-tab URL. The remote `publicUrl` (tailnet) still drives the network-policy host allowlist and `--open`, so a tailnet-fronted daemon still serves mobile on the tailnet URL — run tabs just never ride it. `ensurePortlessRoute` now always runs (in parallel with the tailscale probe) so the portless alias is re-registered for the current bound port even when tailnet fronts the daemon.

- f41f937: Make localterm a fully installable PWA with a maskable icon and an offline service worker.

  The manifest previously held a single data-URI SVG icon and no service worker, so "Add to Home Screen" produced a Chrome-badged shortcut rather than an installable app. The manifest now references file-based icons — an SVG plus 192/512 PNGs declared `purpose: "any maskable"` — generated from a single `icon.svg` source via `pnpm generate:icons` (sharp). The full-bleed `#f4f4f5` background with a centered emerald `>_` sits inside the maskable safe zone with ~2.4 units of margin, so circular/squircle Android launchers apply their own shape and drop the Chrome badge, and iOS gets a clean `apple-touch-icon`.

  A build-time service worker (`scripts/generate-sw.mjs` from `sw-template.js`, run as the last `build` step) precaches the app shell, all font subsets, the icons, and the manifest under a content-hashed version, serves navigations network-first with the cached shell as the offline fallback, bypasses `/api` and `/ws`, and purges stale caches on activation. Registered from the terminal only in production builds.

  The manifest gains `id`, `lang`, `dir`, `categories`, and `launch_handler` (reuse existing window on relaunch), and `index.html` gains `apple-touch-icon`, `mobile-web-app-capable`, `apple-mobile-web-app-title`, and `application-name`. The app root is padded with `env(safe-area-inset-*)` so the terminal and toolbar clear phone notches and the home-indicator bar in standalone mode.

  Server: the static resolver now serves `.webmanifest` as `application/manifest+json` (it was `application/octet-stream`, which strict browsers reject) and sends `cache-control: no-cache` for `/sw.js` and `/manifest.webmanifest` so a new build is detected promptly.

## 2.17.3

## 2.17.2

### Patch Changes

- 4ac3ea0: Accept the `tailscale serve` Host on a loopback bind by trusting the surface origin the CLI resolved via `setPublicUrl`. The network-policy host check previously only allowed loopback names / private IP literals / `.localhost`, so a request fronted by `tailscale serve` — which preserves the MagicDNS `Host` header — was rejected with `forbidden: host not allowed`. Under userspace-networking tailscaled there is no host `100.x` interface to bind, so `serve → localhost:<port>` is the only ingress; this makes that surface reachable by its DNS name (no IP-literal + cert-name-mismatch workaround needed). The check also extends to the `Origin` header for same-origin browser/WS requests, and still rejects unrelated DNS names and cross-origin requests from public sites.

## 2.17.1

### Patch Changes

- 1326d81: Stop leaking terminal identity-query responses into the shell on session switch, browser tab switch, and closing a TUI switched to via the session picker — without maintaining an unbounded server-side query-sequence stripper — and fix scrolling when switching into a TUI.

  The leaks share a root cause: a terminal identity query is a synchronous, in-process protocol, but in localterm the terminal emulator (xterm.js) is across a WebSocket from the PTY, so xterm's response round-trip (server batch + WS + xterm's async `setTimeout(0)` parse + WS back + PTY) is structurally ≥10ms. A probing program that issues the query with a short read timeout, or that exits before the response arrives, gives up and the response is orphaned in the PTY stdin — the next reader treats it as typed text (e.g. `62;4;9;22c`). Latency tuning can't win this race reliably (every program's timeout differs), so the fixes either keep the query out of xterm's hands or answer it in-process.

  - **Server-side DA1/DA2 responder** (the tmux/mosh model) — the primary fix for the reported DA1 leak. A new `TerminalQueryResponder` captures xterm.js's DA1/DA2 responses the first time they round-trip (cold cache = today's behavior, fine on a fresh spawn where the shell reads patiently), then answers every subsequent probe across every PTY instantly by writing the cached response straight to the PTY and removing the request from the output so xterm never sees it and never responds — nothing round-trips. (Switching to a neovim PTY and `:q`: the attach resize → SIGWINCH → neovim re-probes DA1 → the server answers before neovim's read window closes, so no orphaned response.) Scope is a fixed, standard, stateless family (DA1 `CSI [Ps] c`, DA2 `CSI > [Ps] c`) with unambiguous CSI finals, so exact-match removal can't corrupt the stream and split requests just pass through. This is NOT the rejected server-side stripper: that rewrote the scrollback replay to drop an open-ended, enumerated set of query variants (unbounded, lossy); this intercepts a fixed set of live identity queries and replays a captured response. DA3 (`CSI = c`) is excluded (xterm.js doesn't answer it — no response to orphan); stateful queries (DECRQM, OSC color) stay out of scope.

  - **Replay suppression** (replaces the server-side stripper for the replay path). The scrollback replay carries the raw PTY bytes, including stale query requests (DECRQM/OSC/DSR) the shell emitted once; replaying them into a fresh xterm re-evaluates each request and makes xterm re-emit its response, which the client would forward to the live PTY. DA1/DA2 no longer reach the replay (the responder removes them at append time), but the other queries do, and enumerating them server-side is unbounded. So the server brackets the replay with a `{type:"replay-end"}` marker; the client buffers the replay frames and writes them as one `terminal.write` block with `onData` suppressed, dropping xterm's responses to ANY stale request regardless of sequence — bounded, present-and-future. Suppression holds until xterm's write callback fires (its WriteBuffer drains in 12ms chunks); the window is reset at the top of every session frame so a failed attach can't leave onData suppressed.

  - **Output latency** (defense-in-depth for non-DA queries + input-echo UX). The OutputBatcher flushes synchronously (calling `terminal.write` immediately) while the document is hidden (rAF is paused in background tabs) and for small visible output (`OUTPUT_SYNC_FLUSH_MAX_BYTES`, 8 KB — queries <1 KB, TUI redraws 3–6 KB), so any non-DA query that still round-trips to xterm is parsed and answered in the same task, keeping its response inside the probe's read window. Large buffers exceed the threshold and keep rAF coalescing for throughput; the high-throughput path is unchanged. A keep-warm rAF is re-armed after a sync flush so a run of small interactive frames keeps the compositor's frame loop warm.

  Server — restore live terminal modes on replay. `snapshotScrollback()` prepends a restore prefix from a new `TerminalModeState` tracker that watches DECSET/DECRST as output flows, so switching into a long-running TUI re-enters the alt screen and re-enables mouse even when the TUI's mode-set sequences have scrolled out of the 256KB replay window — otherwise the wheel scrolled xterm's scrollback instead of the TUI. Tracked: alt-screen (1047/1048/1049), mouse (1000–1007/1015), bracketed paste (2004), cursor hide (25). Synchronized-output (2026) excluded (restoring it risks a frozen screen mid-redraw); kitty keyboard is a push/pop stack left to the replay bytes.

  Client — re-assert DECTCEM (cursor visible) after `terminal.reset()` on a session switch. xterm's RIS reset does not clear `coreService.isCursorHidden` — only `?25h`/`?25l`/softReset do — so a source PTY that had hidden the cursor left it hidden on the fresh surface, and an empty target PTY sent no replay to re-establish its own cursor state, leaving the cursor invisible.

- 1ff7c56: Sort the session switcher by activity then recency instead of by created time, and open it on the last switched session for alt-tab-style quick switching.

  The switcher now orders rows: the current tab's session pinned first, then grouped by favicon activity (running first, alive-quiet second, ready last), and within each group by most-recent output so the shells you last touched float up. The server surfaces `lastOutputAt` on each session list row to drive the recency ordering.

  Opening the switcher now highlights the shell this tab last switched away from (the one viewed immediately before the current), so opening it and pressing Enter quick-switches back, alt-tab style — instead of landing on the current (pinned) session where Enter was a no-op. When that session was reaped or hasn't been recorded yet, the highlight falls back to the first switchable row so Enter still switches.

## 2.17.0

### Minor Changes

- Surface the CDP background-tab path (no focus steal, closeable automation run tabs) across the first-time install UX so a user can tell whether it's on and how to enable it:

  - `/api/health` reports the daemon's persistent CDP socket state as a `cdp` field (`{ connected, browser? } | null`).
  - `localterm start` prints a `cdp:` line — background tabs via the detected browser, or the OS opener with a pointer to `localterm install`.
  - `localterm status` prints the CDP mode (background + closeable via CDP / OS opener / disabled).
  - `localterm install` runs a CDP probe step alongside the portless and tailscale checks, with the `--remote-debugging-port=9222` hint.
  - The automations modal locks `Close tab when finished` off with an amber warning when no debug-enabled Chromium is connected, instead of letting the setting save as a silent no-op.

## 2.16.5

## 2.16.4

## 2.16.3

### Patch Changes

- 0aef8a5: Keep a dormant PTY alive while a foreground program runs quietly, not only while output is streaming. The no-clients grace reap re-checked only output recency — a shell whose tab favicon would still be green — so a quiet-but-running shell (the favicon's blue `alive-quiet` state: a `sleep`, a paused build, an editor waiting on input) was reaped once output went quiet, even with no viewers. The re-check now reuses the same favicon-equivalent activity state already surfaced on the session list and spares any shell that's `running` or `alive-quiet`, reaping only a truly idle one (`ready`). The `SessionActivityState` comment's stated intent — "gates the grace reap so a quiet-but-running shell isn't reaped" — now actually holds.

## 2.16.2

### Patch Changes

- Restore the current/active/orphaned attachment pills in the session list, alongside the activity-colored terminal icon. The pill says who's viewing (current/active/orphaned); the icon color says what the shell is doing (running/quiet/idle).

## 2.16.1

### Patch Changes

- Keep active dormant PTYs alive and color sessions by activity. A dormant shell (no attached clients) that's still producing output — a build, a long command — is no longer reaped mid-stream: the grace timer re-checks on fire and reschedules while output is recent, so only a truly idle shell (quiet long enough that the tab favicon would be grey) is reaped. This is the same output-recency signal the client's favicon uses, now driving both the session-list row color and the reap decision. Each row's terminal icon is colored by a favicon-equivalent state (running / alive-quiet / ready), computed server-side and added to the session-list schema.

## 2.16.0

### Minor Changes

- ea27ef3: Add true PTY multiplexing: a shell now outlives the tab that spawned it, and any tab can switch to it from the session switcher.

  Closing a tab detaches instead of killing — the shell waits (dormant) for a 30s grace window, then is reaped if no tab reattaches. One authority spawns a shell; others join alongside via the switcher. This replaces the prior 30s `SessionReattachPool` grace (same-tab-only) with a daemon-wide `SessionManager` that owns every live PTY, supports any number of attached clients per PTY (output/title/cwd/foreground/exit fan out to all of them), tmux-style min(cols)/min(rows) resize across clients, OS-pipe backpressure that pauses the PTY when any client falls behind, and a continuous per-session scrollback ring buffer replayed on attach so a switching tab lands on recent output instead of a blank screen.

  New surface: `GET /api/sessions` (list live PTYs), `DELETE /api/sessions/:id` (kill). The WS gains a `{type:"ready", replay}` handshake — the localterm client sends it after the session frame so the scrollback replay lands before live fan-out on a switch; a back-compat client that never sends it (and never sends input) is auto-promoted after a 100ms window with its buffered output flushed, so no output is ever lost and older clients keep working. `?sid=` now attaches to any live PTY by id, not just the same-tab parked one.

  The terminal app adds a sessions modal in the top-right toolbar (SquareTerminal icon, `⌘`/`Ctrl+I`), styled as a command-palette overlay with search, virtualized rows, keyboard navigation, and active/orphaned status pills. The command palette gains a "Sessions" entry. `SessionRegistry` + `SessionReattachPool` are replaced by `SessionManager` (+ extracted `GitDirtyCoordinator` and `utils/ws-socket`).

## 2.15.3

## 2.15.2

### Patch Changes

- 57c1e46: Bump devDependencies: @types/node 26.0.0 → 26.0.1, turbo 2.9.18 → 2.10.0, portless 0.14.0 → 0.15.0.

## 2.15.1

## 2.15.0

## 2.14.0

### Minor Changes

- 75932da: Add a `webhook` automation trigger: an external `POST /api/webhooks/<id>` fires the automation.

  The trigger union gains a fourth kind. A webhook automation's `id` is a server-generated 128-bit base64url capability token (Discord-style: anyone with the URL can fire it) — the client sends `{kind:"webhook"}` with no id at create time and reads the id back from `trigger.id`. The id is preserved across PATCHes that keep the webhook kind (so editing the command/name never rotates the URL configured in CI) and guaranteed unique across all automations. The POST body is ignored: `command`/`cwd` are fixed at create time, so a webhook is a pure signal like schedule/watch/event — no payload templating, no injection surface. A new `WebhookTriggerManager` mirrors the watch/event managers: a trailing debounce coalesces duplicate delivery (a CI retry, an LB double-fire) into a single run, and an in-flight guard drops a POST that arrives while a prior run is still launching/running. Webhook runs count toward the `limit`.

  The route returns `202 {"accepted":true}` on a valid+active id (always 2xx so a CI retry loop never amplifies — duplicates coalesce, in-flight POSTs are silently dropped), `404 {"error":"not_found"}` for an unknown id, and `409 {"error":"automation_not_active"}` when disabled/finished. The existing network policy middleware already gates the endpoint to the bound surface: loopback-only on a loopback bind, or any private host (incl. tailscale's `100.64.0.0/10` CGNAT range) on a non-loopback bind — so a POST from another tailnet device reaches it with no extra wiring. The terminal app's automation modal adds "On a webhook" as a fourth trigger type and shows the webhook URL (with a copy button) in the detail view, built from the page's own origin so it tracks the surface the user is browsing (tailnet / portless / loopback).

  To keep `node:crypto` out of the terminal app's browser bundle, trigger normalization (which generates the webhook id) moved from `compile-schedule.ts` (imported by the browser for cron preview) into a new server-only `utils/normalize-trigger.ts`.

## 2.13.3

## 2.13.2

### Patch Changes

- 8ca4be4: Cut the per-PTY syspolicyd spike and restore the portless surface for automation run tabs.

  The launchd-managed daemon spiked syspolicyd to ~30% on every PTY open because the plist baked the full user `PATH` (added in 2.12.0 so the daemon could find `portless`), which leaked into the PTY login shell and the daemon's own `git`. A launchd agent has no GUI provenance, so the ad-hoc Homebrew binaries that mise/direnv bootstrapped (`direnv`, `git`) were re-assessed by syspolicyd per prompt — ~207 violates / 621 SecKeyVerify per PTY, never cached. Pre-2.12.0 the plist set only `HOME`, so the daemon ran on launchd's minimal `/usr/bin:/bin` and the spike was ~3/9.

  Three changes restore the pre-portless behaviour without losing the portless surface:

  - The plist now bakes a minimal system PATH plus the daemon's own `node` dir and `portless` dir (captured at `localterm install`). The daemon still finds `portless` (named `.localhost` URLs) and `node`, but no longer pulls Homebrew/mise onto its PATH. User shells bootstrap their own tools via rc files like any login shell, and now resolve the correct mise-managed `node` instead of Homebrew's. `LOCALTERM_PTY_FULL_PATH=1` opts back into the old leaky behaviour.
  - The daemon's `git` (diff summaries, repo detection on every PTY) now resolves to `/usr/bin/git` (Apple-signed, cached regardless of provenance) when it's a real git, falling back to PATH-resolved `git` where `/usr/bin/git` is only the Xcode shim.
  - `isProxyLive` (the portless liveness probe) now checks both `127.0.0.1` and `::1` on `:443`. portless's network extension serves loopback on IPv6, so the old IPv4-only probe timed out and the daemon fell back to the loopback URL even when portless was healthy — automation run tabs opened at `http://localterm.localhost:<port>` instead of `https://localterm.localhost`. Re-run `localterm install` to rewrite the plist, then restart.

  Also fixes a pre-existing parse error in `automations-api.test.ts` (a stray `"` where a backtick was meant left a template literal unclosed), which had prevented the "automation run tab surface" suite from running since 2.13.0.

## 2.13.1

### Patch Changes

- 1e27858: Open automation-run tabs at the announced surface instead of the loopback URL.

  Automation runs always opened at the hardcoded `http://localterm.localhost:<port>` loopback URL even when portless (or Tailscale) fronted the daemon, so a scheduled run landed on the http tab instead of `https://localterm.localhost`. The CLI now hands the daemon the surface it resolved (best-first: tailnet → portless → loopback) through a new `publicUrl` server option / `setPublicUrl` setter on `RunningServer`, and `tryLaunch` builds the run-tab URL from that origin. The CDP tab filter (`isLocaltermTabUrl`) also recognises the announced origin, so ambient-token injection and `closeOnFinish`'s CDP `closeTab` keep working behind the proxy — a portless URL carries no port and a tailnet URL is on `:443`, both of which the old `parsed.port === String(port)` check rejected.

  Separately, the launchd-managed daemon still resolved to loopback even with the above, because the generated plist set only `HOME` — no `PATH` — so the daemon (launched with launchd's minimal `/usr/bin:/bin`) couldn't find the `portless` binary and `resolveDaemonUrl` fell back to loopback with a "portless not installed" warning. `buildPlistContent` now bakes the install-time `PATH` into the plist's `EnvironmentVariables` (XML-escaped), so the daemon finds `portless` (and Homebrew `git`, mise shims, etc.) the same way a foreground `localterm start` does. Re-run `localterm install` to rewrite the plist with the PATH, then restart.

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

## 2.12.4

### Patch Changes

- 3c28588: Seed the session frame with the live title on reattach instead of the frozen spawn-cwd title. A silently reattached tab (WS drop across laptop sleep or a transient blip while the PTY stayed parked) previously reverted its document/tab title to the directory the shell was spawned in — because the reattach frame sent `initialDocumentTitle`, which is computed once at spawn and never updated. The frame now sends `currentTitle` (the title the tab was last showing), so a reattached tab keeps its current directory's title instead of flipping back to the original cwd until the next prompt corrects it.

## 2.12.3

### Patch Changes

- a68cc2b: Broadcast git-diff-summary to every tab sharing a cwd so sibling directory tabs stay in sync. A git operation run inside one of two side-by-side tabs previously updated only that tab's metadata — its shell's precmd OSC hook fired, but the idle sibling got no signal and stayed stale until its own next prompt (or a lucky fs.watch event). A per-cwd GitDirtyCoordinator now dedups the summary computation and fans the recomputed summary out to all subscribed sockets, so both tabs refresh together and the branch/PR lease re-leases off the updated branch.

## 2.12.2

### Patch Changes

- 55e8f66: Keep the persistent CDP socket alive across sleep/wake so automations stop re-prompting for the browser's remote-debugging connection.

  The daemon opens exactly one CDP WebSocket at `start` (so you clear the browser's one-time remote-debugging prompt a single time) and is meant to reuse it for every automation run. But the socket had no keepalive: after a laptop sleep the loopback socket usually survives with the OS while the wall clock jumps, so `isConnected()` still reported `OPEN` yet the next `Target.createTarget` call stalled for the full call timeout and then tore the socket down — the subsequent reconnect opened a _fresh_ socket and re-triggered the debugging prompt. That is why automations appeared to re-prompt the CDP connection instead of reusing the one localterm started with.

  The client now runs a heartbeat mirroring the PTY WS keepalive: any inbound CDP frame (reply or unsolicited `Target` event) refreshes a liveness timestamp; after a quiet window the heartbeat probes with a cheap `Target.getTargets` round-trip rather than assuming death. A live-but-silent socket replies and is reused — no reopen, no re-prompt. A genuinely half-open socket leaves the probe unanswered past the call timeout and is torn down proactively, so the next run reconnects cleanly instead of stalling `createTarget` for five seconds first.

## 2.12.1

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

## 2.11.1

### Patch Changes

- 202e623: Give the WS heartbeat one grace ping before terminating on a stale `lastPongAt`.

  When the heartbeat interval fired past the idle threshold, the previous code
  terminated the socket immediately, before sending a fresh ping. On a laptop
  wake this was a latent false-positive path: `Date.now()` advances during
  sleep (RTC keeps running), so if the interval fired post-wake `idleMs` could
  already be minutes past the 60s timeout even though the socket itself was
  still alive — the connection just never got a chance to prove it.

  Now when the idle threshold trips, the server sends one fresh ping and waits
  `WS_HEARTBEAT_GRACE_MS` (15s) for a pong before terminating. A live socket
  pongs inside the grace window and the session survives; a genuinely
  half-open one stays silent and terminates on the next tick — about one extra
  interval of lag for dead-connection teardown, which is well within the
  tolerance of the existing teardown path.

  This is a defense-in-depth fix for the stale-`lastPongAt` path only; it does
  not address terminal sessions dying on sleep when proxied through portless.
  That symptom comes from portless's WebSocket proxy destroying both halves of
  its two-socket pipe on any side's `close`/`error`/`end` during wake — which
  surfaces as a `1006 wasClean=false` on the daemon side before the heartbeat
  interval ever runs, and is followed by `onClose` tearing down the PTY. A
  separate change to detach PTY lifetime from WS lifetime is needed to survive
  that.

## 2.11.0

## 2.10.1

### Patch Changes

- afcca5d: Close the persistent CDP WebSocket explicitly when `openBackgroundTab`'s
  `Target.createTarget` call rejects, instead of just unassigning `this.ws`.

  Previously the catch flagged the socket as gone by setting `this.ws = undefined`
  and `connectedBrowser = undefined`, but never called `.close()` on the abandoned
  `WebSocket`. When the call rejected via a `callTimeoutMs` timeout while the
  socket was still `OPEN` (the common case — the browser hadn't dropped the
  connection, it just never replied), the live socket was leaked. The next
  `connect()` then opened a _second_ live socket alongside the orphaned one, and
  the ambient token/handler maps kept stale entries from the dead session.

  The fix routes teardown through `failPending` (which clears the token↔targetId
  maps and event handlers in one place) after explicitly `close()`-ing the stale
  socket. `failPending`'s `if (this.ws !== ws) return` guard makes this safe
  against a concurrent reconnect that already swapped in a fresh socket between
  the timeout firing and the catch running.

## 2.10.0

## 2.9.0

## 2.8.2

### Patch Changes

- ef9a827: Bump dev dependencies to latest: TypeScript 5.9 → 6.0, @types/node 25 → 26, vite-plus / @voidzero-dev/vite-plus-core 0.1 → 0.2. Removed `baseUrl` from the terminal tsconfigs, which TypeScript 6 now hard-errors on (TS5101).

## 2.8.1

## 2.8.0

### Minor Changes

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

## 2.7.6

### Patch Changes

- Add test coverage for the binary-output WebSocket paths shipped in 2.7.5: the client-side cross-realm ArrayBuffer dispatch fallback, the OutputBatcher's byte-buffer growth past the initial capacity, and the keep-warm rAF cadence; plus a server-side assertion that output frames arrive as raw binary ArrayBuffers rather than JSON text.

## 2.7.5

### Patch Changes

- Emit PTY output as raw UTF-8 binary WebSocket frames instead of JSON `{type:"output",data}` messages, and raise the batch early-flush threshold from 8KB to 32KB.

  JSON.stringify/parse of terminal output was the dominant per-byte cost on the renderer main thread — ~36% of main-thread busy in steady-state output, scaling linearly with payload size due to per-character escape scanning on both sides. PTY output is already bytes; the server now UTF-8-encodes the accumulated batch once at flush and emits a single binary frame. The client dispatches by `event.data instanceof ArrayBuffer` and hands the bytes directly to the output batcher with no JSON.parse and no string roundtrip.

  The 8KB flush threshold made 15MB/s output produce ~1880 WebSocket messages/sec, burning ~9.4ms of every 16.6ms frame on invisible per-message RunTask plumbing. Coalescing four times more (~32KB) reduces that to ~470 msg/sec (~2.4ms/frame), freeing ~7ms/frame while keeping batch latency at ~2ms at 15MB/s — imperceptible. xterm.js's own parser amortises parse across batched bytes; its internal chunk cap (~15ms) parses a 32KB batch in ~6ms, under the cap.

  The `output` variant is removed from `serverToClientMessageSchema`; output frames are now dispatched by ArrayBuffer type on the client.

## 2.7.4

## 2.7.3

## 2.7.2

## 2.7.1

## 2.7.0

### Minor Changes

- Hide stale merged PRs from the toolbar indicator and diff viewer on base branches (main, master, dev, develop, staging, production) once they're older than a week. A merged PR lingering on a base branch — e.g. a main→production reverse-merge — is noise once it ages out; feature branches keep their merged-PR indicator indefinitely.

  - The server now forwards GitHub's `merged_at` on each detected PR (new `mergedAt` wire field).
  - The client's PR display state resolves to `null` for a merged PR past the TTL on a base branch, so the toolbar button, diff-viewer branch-mode auto-open, base-picker default, and header chip all drop it consistently.
  - New `BASE_BRANCHES` and `MERGED_PR_OVERLAY_TTL_MS` constants (7 days) in `apps/terminal/src/lib/constants.ts`.

## 2.6.3

## 2.6.2

### Patch Changes

- 8b790ce: Use a muted gray for draft PR state instead of blue so drafts read as inactive, matching GitHub's draft treatment.

## 2.6.1

### Patch Changes

- 7055b95: Clarify the worktree PR input placeholder so users know entering a number opens that PR as a worktree, instead of only showing the expected format.

## 2.6.0

### Minor Changes

- 8f76ed3: Add a `.worktreeinclude` editor to the worktree settings panel. The file can now be read and written via `/api/git/worktrees/include-file`, with a UI that shows whether it exists and lets users create or update it.

## 2.5.1

### Patch Changes

- 0abad5d: Stop emitting `git-commit` (and the other op-level git events) when a branch
  ref is merely created or deleted rather than advanced. `git worktree add -b`,
  `git branch`, and `git branch -d` flip the `heads/` namespace and previously
  fell through to `git-commit`; now only `git-branch-change` fires for those.
  Op-level classification (`git-commit` / `git-merge` / `git-rebase` /
  `git-reset` / `git-cherry-pick`) is gated on an existing branch ref actually
  changing SHA.

## 2.5.0

### Minor Changes

- 2a0858a: Reflect PR draft and merge-conflict states with Lucide icons in the toolbar and diff viewer

## 2.4.1

### Patch Changes

- Flush a trailing `git-dirty` event so external file saves refresh the diff viewer in the background.

  The git-diff watcher's throttle was leading-edge-only, so a burst of `fs.watch` events (temp write → atomic rename on every external save) produced a single `git-dirty` against an intermediate tree state. That intermediate snapshot got cached, and with no trailing signal the cache stayed stale — the diff viewer didn't update until it was opened or the refresh button was pressed. The throttle now emits on the leading edge and once more after the burst settles, so the final tree state is always signaled.

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

## 2.3.0

### Minor Changes

- e6e4ac2: Add a per-project git worktree creation flow. Creating a worktree now happens
  without a form and lands under `~/.localterm/worktrees/<project>/` on a memorable
  adjective-noun branch (e.g. `clever-fox`). Two same-named repositories are put in
  distinct project folders via a per-repo marker. The main worktree can never be
  removed (server-enforced), the virtualized list no longer overlaps, and a
  `⌘/Ctrl+Shift+B` shortcut plus "Create git worktree" command-palette entry open
  the new worktree in a new tab.

## 2.2.3

### Patch Changes

- Remove realtime diff viewer line animations

## 2.2.2

### Patch Changes

- Warm diff viewer prefetch on open for branch mode and pre-open git-dirty.

## 2.2.1

### Patch Changes

- 1d346bc: Fix realtime diff animation placement for deleted lines, handle add/remove/add-back edge cases, and add unit tests for the transition logic.

## 2.2.0

### Minor Changes

- Animate newly added diff lines in realtime

## 2.1.6

## 2.1.5

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

## 2.0.3

## 2.0.2

## 2.0.1

## 2.0.0

### Major Changes

- 0de44bd: Replace the umbrella `git-refs-change` and internal `git-dirty` session events with granular namespace and operation events (such as `git-head-change`, `git-commit`, `git-checkout`, `git-merge`, etc.). Event-based automations now use an `events` array and fire when any selected event occurs. The automation form uses a new Notion-like multi-select search for picking events.

## 1.42.0

### Minor Changes

- Refresh the diff viewer in realtime as working-tree changes happen in the background, and fix the lint scripts so they consistently enumerate source files.

## 1.41.15

### Patch Changes

- 6a74c60: Wire the restart and stop commands to launchd when the localterm launchd service is loaded. Restart now uses `launchctl kickstart -k` and stop uses `launchctl stop`, with the original manual PID-based behavior as a fallback when launchd is not managing the daemon.

## 1.41.14

### Patch Changes

- 76a5de7: Fix launchd auto-start respawn loop that caused continuous syspolicyd activity on macOS. The launchd plist now runs the daemon directly in the foreground with crash-only KeepAlive, and the start command exits cleanly when another instance is already running under launchd.

## 1.41.13

### Patch Changes

- 749cd31: Drop the refresh button from the diff viewer header at the narrowest disclosure breakpoint so the close button remains reachable.

## 1.41.12

## 1.41.11

### Patch Changes

- Highlight the active keep-awake trigger in the overlay and improve automatic command detection for script shims and versioned binaries.

## 1.41.10

### Patch Changes

- Fix diff viewer and automations modal bugs
  - Fix flash of missing sidebar on modal open (zero-width measurement guard + missing mounted dependency)
  - Fix forever-loading patches after refresh/close-reopen (PrefetchQueue.clear() no longer permanently bricks the queue)
  - Animate sidebar collapse/expand smoothly instead of abrupt layout jump
  - Remove compact split-diff fallback mode — split mode now always renders true side-by-side with horizontal scroll

## 1.41.7

### Patch Changes

- Fix launchd respawn loop causing syspolicyd CPU spins on macOS

## 1.41.4

### Patch Changes

- Fix flash of unhighlighted diff text during syntax tokenization

## 1.41.3

### Patch Changes

- b578aca: Make spawn-helper signing conditional to prevent syspolicyd CPU spike on every daemon start

## 1.36.0

### Minor Changes

- Extract `memoBy` utility from inline dedup patterns

  Replace scattered `Set`-based dedup loops and `[...new Set()]` spreads with a
  single `memoBy(items, keyFn)` utility that keeps the first occurrence per key
  — the same memo-table pattern as DataLoader's memoization layer.

## 1.35.1

### Patch Changes

- 0cc8ee0: Deduplicate `handleGitDirty` calls during git checkout event storms and clear `spawn-helper` quarantine

## 1.31.0

### Minor Changes

- Add activity gate for automatic keep-awake mode

  When the activity gate is enabled (the default), automatic mode now only
  keeps the system awake while a recognized program is actively producing
  output. After 5 seconds of silence, caffeinate releases — so an idle
  coding agent at a prompt no longer holds a power assertion. Users who
  prefer the old behavior can toggle the activity gate off in the keep-awake
  menu.

## 1.25.4

### Patch Changes

- fix: suppress startup red-dot favicon badge when no foreground process ran

## 1.25.3

### Patch Changes

- Fix optical centering of "A" badge in keep-awake automatic mode

## 1.25.2

### Patch Changes

- Fix zsh prompt reverting to macOS default when daemon is spawned from inside localterm

## 1.25.1

### Patch Changes

- Fix restart daemon dying on startup and plist missing PATH

## 1.25.0

### Minor Changes

- Add launchd install/uninstall commands and spawn-first restart handoff

## 1.24.1

### Patch Changes

- 0d6f2e6: Fix the diff viewer's PR detection showing the wrong PR, and make the PR indicator react to branch switches.

  `gh pr list --head <branch>` matches the branch _name_ across every fork, so on a common branch name like `main` it returned a stranger's same-named PR. PR detection now keeps only PRs whose head repository is your own (the `origin` remote's owner), so an unrelated fork's `main` PR no longer shows up and a branch with no PR of your own correctly shows none.

  The ambient PR indicator now updates when you switch branches, using the same event channel as the working-changes indicator (the git watcher's push over the WebSocket — no polling): the diff summary now carries the current branch, and the client re-leases the branch's PR whenever the branch changes.

## 1.24.0

### Minor Changes

- a9466af: Add a "compare against a base branch" mode to the diff viewer. Alongside the existing working-tree diff, the viewer can now diff your current working state against a base branch using the merge base — so committed changes on your branch plus any uncommitted/untracked work show up, while changes the base made after you forked don't (the same set GitHub shows for a PR). When the branch's tree is clean this is "the whole PR"; with local edits it's "where I am right now vs base".

  The branch's GitHub PR (if any) is detected ambiently for the active directory and surfaced as a state-colored PR indicator (open = green, merged = violet, closed = red) in the terminal toolbar — next to the working-changes count, or on its own when there are no working changes — so a branch with a PR is always one click away from its diff. PR detection uses `gh pr list --head <branch> --state all` (per remote, in parallel), so it finds merged and closed PRs too — not just open ones — and is fork-aware: a PR targeting the upstream of a fork is still found.

  The comparison mode is ephemeral (not persisted): the viewer opens in working mode and switches to branch mode when the branch has a PR. Because the PR/branch metadata is leased ambiently and handed to the viewer, opening a PR branch lands on branch mode instantly. The branch base is resolved from local git (`origin/HEAD` → `main`/`master`) and overridable from a branch picker; the branch diff is computed entirely from local git and never blocks on `gh`, so it loads as fast as the working-tree diff. Branch/PR metadata is fetched once per directory (never polled), and `gh` is strictly best-effort: if it's missing or unauthenticated, everything falls back to local git.

  New endpoints/options: `GET /api/git/branches` returns the candidate refs, resolved default base, and detected PR; the diff endpoints (`/api/git/diff`, `/git/diff/files`, `/git/diff/file`) accept `mode=working|branch` and an optional `base` ref.

## 1.23.1

### Patch Changes

- ea65411: Require `trigger` on the automations create/update API and drop the legacy top-level `schedule` field. An automation's trigger is now always specified via `trigger` (`{kind:"schedule", schedule}` or `{kind:"watch", recursive}`); a schedule trigger's `schedule` still accepts a structured object or a bare cron string.

## 1.23.0

### Minor Changes

- 9970740: Add a "watch a folder" trigger for automations as an alternative to a schedule. A watch automation runs its command when its working directory changes, detected via native filesystem events (no polling). A burst of changes is debounced into a single run, and a new run won't start while a previous one is still in flight (so a command that writes into the watched folder won't loop); watch runs count toward the same run limit as scheduled runs.

  Automations now carry a `trigger` union (`{kind:"schedule", schedule}` or `{kind:"watch", recursive}`) in place of a bare `schedule` field. The `~/.localterm/automations.json` file migrates v2→v3 automatically, and the create/update API still accepts the legacy top-level `schedule` (object or cron string) for back-compat.

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

## 1.21.0

### Minor Changes

- 4689b32: Load the git diff viewer instantly and render large diffs progressively. The viewer now fetches the changed-file list first (metadata only) and loads each file's patch on demand — with neighbour prefetch so arrow/`j`/`k` navigation stays instant — instead of fetching every file's patch up front. A selected file paints its first screen immediately and the rest streams in over animation frames without blocking input, replacing the old blocking "show all lines" button. Adds `GET /api/git/diff/files` and `GET /api/git/diff/file` endpoints; a single large file is no longer capped by the whole-response patch budget.

## 1.20.0

### Minor Changes

- 44cbd2a: Sync the toolbar overlay across all open tabs and add a keep-awake coffee button.

  Terminal settings (theme, font, size, line height, cursor, scrollback, padding, Nerd Font) now propagate to every other open tab the moment you change them — the same live-sync that automations already had. The new coffee button in the top-right overlay toggles a machine-wide `caffeinate -dims` keep-awake: the icon tints to a warm coffee tone when active, and because the daemon owns the single process and broadcasts its state, the toggle stays in lockstep across tabs. The button only appears on macOS, where `caffeinate` exists.

## 1.19.2

## 1.19.1

### Patch Changes

- 0118ccf: Dev tooling: manage pnpm via mise (`npm:pnpm@11.6.0`) instead of Homebrew and bump the pinned pnpm to 11.6.0, declaring the pnpm 11 `allowBuilds` gate for node-pty. No runtime changes.

## 1.19.0

### Minor Changes

- cfe35c2: Add an opt-in **Close tab when finished** setting to automations
  (`closeOnFinish`, default false). When enabled, a run's browser tab is closed
  once its command exits — mirroring browser-harness-js's `closeTab` (drive the
  browser's own `window.close()` so forks like Dia/Arc actually drop the tab, then
  tear down the CDP target, with closes serialized through a queue so concurrent
  closes can't interleave and orphan tabs). Only honored for tabs opened via CDP;
  on the OS-opener
  fallback it's a silent no-op. The HTTP API accepts `closeOnFinish` on create and
  update, and the automations modal exposes it as a toggle. Pre-existing
  automations default to keeping tabs open, unchanged.

## 1.18.0

### Minor Changes

- 8297fef: Revamp automations: a full-screen modal (replacing the dropdown) with a
  cross-automation **Recent runs** view and an expandable per-automation run
  history; friendly **structured schedules** (daily / weekdays / weekends /
  specific days / multiple times a day / every N minutes/hours) with raw cron kept
  as an advanced escape hatch; run **limits** ("stop after N runs" → a terminal
  `finished` state, reset to re-run) or run forever; and **downtime-aware** run
  history that records scheduled times the machine missed while asleep as
  `skipped` (reconstructed on the next start from a liveness heartbeat). When an
  automation fires, its tab now opens in the **background** so a scheduled run no
  longer steals focus from your current window: if a Chromium-based browser is
  running with remote debugging enabled, the tab is created behind the active one
  over the DevTools Protocol (`Target.createTarget` with `background: true`) on a
  connection opened once at daemon start and reused for every run; otherwise it
  falls back to the OS opener (macOS `open -g`). Set `LOCALTERM_DISABLE_CDP_TABS=1`
  to force the fallback.

  The automations file (`~/.localterm/automations.json`) auto-migrates v1 → v2 on
  first launch — existing automations and their last run are preserved losslessly.
  The HTTP API accepts the structured `schedule` object (or, for back-compat, a
  bare cron string), adds an optional `limit`, exposes the run history plus a
  derived `cron`/`lastRun`, and gains `POST /api/automations/:id/reset`. The
  `localterm` skill and README are updated to match.

## 1.17.2

### Patch Changes

- 6f1fec7: Fix garbled terminal output and a mis-parked block cursor when a TUI app (e.g. Claude Code) finishes a task. The xterm unicode provider counted invisible format characters (zero-width space, BOM, soft hyphen, bidi marks, word joiners, Arabic prepended signs, Unicode tags) as 1 column while the app's width function counts them 0, so a single such character in an exactly-full line wrapped the row a column early and permanently desynced the app's relative-cursor diff renderer. These are now zeroed (joined into the preceding cell so they consume no column), and the inverse class of Unicode 15.1 wide characters the bundled data under-counts is widened to 2.

## 1.17.1

### Patch Changes

- 37ff69c: Fix input handling in the top-right overlay: the find overlay stayed visible but became click-through once the toolbar hover timer fired (clicks fell through to the terminal and it could not be refocused), and the toolbar's focus-preserving mousedown/keydown handlers also fired for the portaled automations/settings popovers, making their inputs unfocusable and sending typed text to the terminal.

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

## 1.16.4

### Patch Changes

- Fix git-dirty watcher to resolve .git by walking up the directory tree so it works from subdirectories

## 1.16.3

### Patch Changes

- Fix cwd watcher to use recursive fs.watch so subdirectory file changes are detected

## 1.16.2

### Patch Changes

- Replace debounce with leading-edge throttle for faster git-dirty signals, widen flaky test timeouts

## 1.16.1

### Patch Changes

- Watch the cwd directory for out-of-band working-tree changes

## 1.16.0

### Minor Changes

- Replace git diff summary polling with event-driven push model

  The browser no longer polls `/api/git/diff-summary` every 3 seconds.
  Instead, the server pushes the summary over the WebSocket when it
  detects changes via shell prompt hooks (OSC 7777) and `fs.watch` on
  `.git/index`, `.git/HEAD`, and `.git/refs/`. This eliminates the
  constant `git` subprocess spawns that kept `syspolicyd` at high CPU.

## 1.15.1

### Patch Changes

- 0c68b11: Revert terminal title to cwd-derived value when a foreground process exits

## 1.15.0

## 1.14.1

## 1.14.0

## 1.13.1

### Patch Changes

- fix(terminal): remove settings tooltip from overlay bar

## 1.13.0

## 1.12.0

### Minor Changes

- Add git diff viewer with server-side diff endpoints

## 1.11.3

### Patch Changes

- bf8c1e9: fix: correct emoji variation selector width during TUI streaming

  Remove `terminal.unicode.activeVersion = "15"` override that was downgrading xterm.js from the grapheme-aware `"15-graphemes"` provider to the naive `"15"` provider. The non-grapheme provider fails to join U+FE0F (variation selector-16) with the preceding emoji, treating it as a phantom width-1 cell. This shifts cursor positions by +1 per emoji, causing TUI redraws to leave ghost-line artifacts.

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

## 1.9.1

### Patch Changes

- Fix terminal not scrolling to bottom after split-tab resize

## 1.2.0

### Minor Changes

- Generate 256-color palette from base16 theme via CIELAB interpolation

## 1.0.0

### Major Changes

- feat: add kitty graphics protocol support via xterm image addon beta

## 0.1.4

### Patch Changes

- Include initial title in the session WebSocket message so document.title updates immediately on load instead of staying as the default.

## 0.1.3

### Patch Changes

- Fix OSC 7 hook injection to prevent commands being echoed to the terminal on startup. Uses ZDOTDIR for zsh and --rcfile for bash instead of writing to the PTY stdin.

## 0.1.2

### Patch Changes

- Inject OSC 7 chpwd/PROMPT_COMMAND hooks into zsh and bash so CWD changes are detected immediately without polling or child process spawning.

## 0.1.1

### Patch Changes

- Replace title/cwd/foreground polling with stream-based detection

  The title was not updating immediately (or flashing) on directory changes because the server only emitted titles on a 500ms polling interval, and the client had two competing title sources that produced different formats at different times. All polling is removed in favor of parsing OSC 7 (CWD), OSC 0/2 (title), and DECSET/DECRST 1049 (foreground process) directly from the PTY output stream. The lsof/proc CWD resolver is also removed, eliminating syspolicyd pressure on macOS.

## 0.1.0

### Minor Changes

- Show only the tail folder name in the titlebar instead of a truncated path

## 0.0.14

### Patch Changes

- fix

## 0.0.13

### Patch Changes

- fix

## 0.0.12

### Patch Changes

- fix

## 0.0.11

### Patch Changes

- fix

## 0.0.10

### Patch Changes

- fix

## 0.0.9

### Patch Changes

- fix

## 0.0.8

### Patch Changes

- fix

## 0.0.7

### Patch Changes

- fix

## 0.0.6

### Patch Changes

- fix

## 0.0.5

### Patch Changes

- fix

## 0.0.4

### Patch Changes

- fix

## 0.0.3

### Patch Changes

- fix

## 0.0.2

### Patch Changes

- Fix `posix_spawnp failed` error on first shell spawn after `npm install -g localterm`.

  node-pty's prebuilt `spawn-helper` binary loses the executable bit through some npm install paths. We now `chmod 0o755` it lazily inside the `Session` constructor so the very first spawn always works, regardless of how the package was installed (npm, pnpm, yarn, monorepo, global, local).

## 0.0.1

### Patch Changes

- Initial public release.

  `localterm` is a browser-based terminal: one browser tab is one persistent PTY session. The CLI (`localterm start`) spins up a Hono + node-pty + headless-xterm daemon at `http://localterm.localhost:3417/` and ships the xterm.js front-end in the same package. Sessions are addressed by friendly `adjective-animal-suffix` ids in the URL path; closing a tab retires its shell after a 30-second grace window.
