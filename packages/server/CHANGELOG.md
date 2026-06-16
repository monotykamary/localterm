# localterm-server

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
