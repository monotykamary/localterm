# localterm

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
