export const DEFAULT_PORT = 3417;
export const DEFAULT_HOST = "127.0.0.1";
export const FRIENDLY_HOSTNAME = "localterm.localhost";
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 32;
export const DEFAULT_SHELL_FALLBACK = "/bin/sh";

export const TERM_TYPE = "xterm-256color";
export const COLORTERM_VALUE = "truecolor";
export const LOCALTERM_VALUE = "1";

// Keep-awake (macOS only). `-d` display, `-i` idle, `-m` disk, `-s` system
// sleep — held for as long as the spawned process lives.
export const CAFFEINATE_BINARY = "caffeinate";
export const CAFFEINATE_ARGS: readonly string[] = ["-dims"];

// Keep-awake "automatic" mode recognizes these commands out of the box and
// caffeinates whenever one is running in any localterm session. Fixed — the
// user can add their own on top but cannot remove these.
export const CAFFEINATE_AUTO_DEFAULT_COMMANDS: readonly string[] = [
  "claude",
  "codex",
  "opencode",
  "pi",
];
export const CAFFEINATE_PREFERENCES_FILE_VERSION = 3;
// Automatic detection is event-driven (no timer): a `ps` snapshot is taken only
// in response to a foreground change or a session connect/disconnect. This
// debounce window coalesces a burst of such events into a single snapshot; it
// fires once and does not repeat.
export const CAFFEINATE_AUTO_POKE_DEBOUNCE_MS = 150;
// When the activity gate is enabled, caffeinate only stays active while a
// recognized program is producing output. This debounce is the grace period
// after the last output byte before caffeinate turns off — long enough that
// an agent's brief "thinking" pause does not drop the power assertion
// mid-task, short enough to release promptly when the program goes idle.
export const CAFFEINATE_ACTIVITY_GATE_DEBOUNCE_MS = 5_000;
export const MAX_CAFFEINATE_COMMANDS = 50;
export const MAX_CAFFEINATE_COMMAND_LENGTH = 128;
// Battery floor for keep-awake: when the machine is on battery power and at or
// below this percent, the daemon refuses to hold the power assertion (it stops
// caffeinate without changing the selected mode). The default is on, so a
// machine left unplugged stops keeping itself awake before it dies. `null`
// (selectable in the menu as "Off") disables the guard entirely.
export const CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT = 20;
export const CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT = 5;
export const CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT = 50;
// The battery floor is enforced by reading `pmset -g batt` on an adaptive
// schedule rather than a fixed heartbeat. `pmset` reports the charge percent
// and an EWMA "time to empty" estimate; the next delay is 1/TIME_FRACTION of the
// interpolated time-to-threshold (estimate × charge fraction still above the
// floor), so polling tightens as the floor approaches and stays lax far from
// it. Halving (not subtracting a fixed margin) scales the buffer with the
// estimate: the EWMA lags real discharge and the active program drains faster
// than the idle minutes it averaged, so a 2× buffer absorbs a stale-high
// estimate without overshooting. Clamped to [MIN, MAX]: MIN keeps a
// near-threshold reading from busy-looping and drives fast recovery while
// suppressed; MAX bounds the far-from-threshold and on-AC cases. The floor is
// a courtesy guard — macOS still forces low-battery sleep at ~5% regardless of
// caffeinate — so a multi-minute MAX is an acceptable worst-case latency for
// noticing an unplug or a stalled estimate.
export const CAFFEINATE_BATTERY_POLL_MIN_INTERVAL_MS = 5_000;
export const CAFFEINATE_BATTERY_POLL_MAX_INTERVAL_MS = 15 * 60_000;
// Poll at 1/N of the interpolated time-to-threshold. N=2 gives a 2× buffer
// against the OS estimate being stale-high.
export const CAFFEINATE_BATTERY_POLL_TIME_FRACTION = 2;
export const CAFFEINATE_BATTERY_READ_TIMEOUT_MS = 2_000;

export const TITLE_MAX_PATH_SEGMENTS = 1;

/**
 * Strip terminal-emulator identity env vars inherited from the daemon's parent.
 * If we leak e.g. TERM_PROGRAM=ghostty, modern Ink-based TUIs (Cursor Agent,
 * Claude Code) will probe for that terminal's protocol (kitty keyboard,
 * XTQVERSION, XTGETTCAP, OSC 1337, etc.) and — when xterm.js doesn't answer —
 * fall back to a degraded inline-plain rendering instead of the full boxed
 * TUI. Removing these lets the TUI treat us as a generic xterm-256color and
 * render normally.
 */
export const PTY_ENV_DENYLIST = [
  "LOCALTERM_DAEMON_CHILD",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "TERM_SESSION_ID",
  "ITERM_SESSION_ID",
  "ITERM_PROFILE",
  "KITTY_WINDOW_ID",
  "KITTY_PID",
  "WT_SESSION",
  "WT_PROFILE_ID",
  "GHOSTTY_RESOURCES_DIR",
  "GHOSTTY_BIN_DIR",
  "VSCODE_INJECTION",
  "VSCODE_GIT_IPC_HANDLE",
  "ZDOTDIR",
];

export const MAX_INPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
export const MAX_FOREGROUND_LENGTH = 256;
export const MAX_TITLE_LENGTH = 4 * 1024;
export const MAX_NOTIFICATION_LENGTH = 1024;
export const MAX_PENDING_PARSE_BYTES = 4096;
export const MAX_COLS = 1000;
export const MAX_ROWS = 1000;
export const MAX_CONCURRENT_SESSIONS = 64;
// High/low water marks gate the PTY -> WS pipe instead of killing the socket.
// Crossing the high water mark pauses the PTY so the OS pipe absorbs further
// child output until the WS drains below the low water mark, at which point
// we resume. Anything past WS_BACKPRESSURE_THRESHOLD_BYTES is treated as a
// runaway: the WS *did* drain below low water at some point, the receiver is
// genuinely stuck, and we'd rather drop the connection than balloon memory.
export const WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES = 4 * 1024 * 1024;
export const WS_OUTBOUND_RESUME_LOW_WATER_BYTES = 1 * 1024 * 1024;
export const WS_OUTBOUND_DRAIN_POLL_MS = 50;
export const WS_BACKPRESSURE_THRESHOLD_BYTES = 64 * 1024 * 1024;

// Output batch early-flush threshold. During continuous high-throughput output
// (ASCII animations, cat of large files), waiting the full OUTPUT_BATCH_WINDOW_MS
// can accumulate hundreds of KB in one WebSocket message. Flushing when the
// batch passes this size keeps individual messages small, maintaining a steady
// data flow to the client. The value is calibrated to be generous enough for
// the largest single TUI frame (ink erase + repaint typically 3–6KB on a
// 120×40 terminal) so that the 2ms window can still coalesce those frames into
// one message before the size threshold is hit.
export const OUTPUT_BATCH_FLUSH_BYTES = 8 * 1024;

// Output batching window. The kernel PTY delivers child writes in 1024-byte
// chunks on macOS, and node-pty emits each chunk as a separate data event in
// its own event loop iteration — a setImmediate scheduled on the first chunk
// fires before the remaining chunks of the same child write are read. That
// split a single ink/TUI redraw frame (erase + repaint, ~3KB) across multiple
// WebSocket messages, and xterm.js rendering between them flashed the
// half-erased frame (visible flicker in cmd/Claude Code on every keypress).
// A small timer window lets all chunks of one frame (measured 0.02–0.8ms
// apart) coalesce into one message, which xterm.js parses atomically.
// For continuous high-throughput output, OUTPUT_BATCH_FLUSH_BYTES triggers an
// immediate flush regardless of the timer, keeping the data flowing.
export const OUTPUT_BATCH_WINDOW_MS = 2;

// Heartbeat: send a WS ping every N ms; if no pong arrives within the timeout
// we tear down the socket. Without this, half-open connections (laptop sleep,
// VPN dropout, kernel‑side TCP keepalives at 2h+) wedge the session — the
// server keeps a dead PTY tied to a phantom client and the browser eventually
// trips its own write error and shows "Shell ended" with no idea why.
export const WS_HEARTBEAT_INTERVAL_MS = 20_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 60_000;
export const FOREGROUND_POLL_INTERVAL_MS = 250;
// Hard ceiling for server.stop() — clients get terminated, then the http
// server is given this long to actually close before we resolve anyway. Keeps
// the daemon's SIGTERM path bounded so the CLI's force-exit fallback never
// fires for normal shutdowns.
export const SERVER_STOP_GRACE_MS = 1_500;

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "[0:0:0:0:0:0:0:1]"]);

export const HTTP_STATUS_NOT_FOUND = 404;
export const HTTP_STATUS_BAD_REQUEST = 400;

// Git diff endpoints. The summary endpoint is polled by the browser every few
// seconds, so every limit here exists to keep one poll cheap and to keep a
// pathological working tree (huge generated file, thousands of untracked
// files) from wedging the daemon or ballooning a single HTTP response.
// SHA of git's well-known empty tree object — the diff base for a repository
// that has no commits yet, so a brand-new repo still reports its staged files.
export const GIT_EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Untracked files aren't covered by `git diff`, so we stat/read them
// ourselves (size+mtime cached between polls). Caps bound the per-poll
// filesystem work; files past the byte cap keep an approximate line count
// from the read prefix and drop their patch.
export const GIT_MAX_UNTRACKED_FILES = 200;
export const GIT_MAX_UNTRACKED_FILE_BYTES = 1 * 1024 * 1024;
// Binary sniff window: a NUL byte in the first 8KB marks a file as binary,
// matching git's own heuristic (buffer_is_binary checks the first 8000 bytes).
export const GIT_BINARY_SNIFF_BYTES = 8000;
// Per-file and whole-response patch caps for /api/git/diff. Files past the
// per-file cap keep their stats but drop the patch text (the viewer shows a
// "too large" notice); past the total cap all remaining patches are dropped.
export const GIT_MAX_PATCH_BYTES_PER_FILE = 1 * 1024 * 1024;
export const GIT_MAX_TOTAL_PATCH_BYTES = 10 * 1024 * 1024;
export const GIT_DIRTY_THROTTLE_MS = 100;
// The diff viewer opens into branch mode when a PR exists, then its prefetch
// queue asks for ~every file's patch. The full diff pass (one tree diff + a
// jsdiff per file) is cached per (cwd, mode, base) so those per-file requests
// are O(1) map lookups instead of each re-running the whole pass (O(files²)).
// Invalidated on a git-dirty signal; this TTL is the backstop for a missed
// invalidation so a stale tree can't be served indefinitely.
export const GIT_CACHE_TTL_MS = 5_000;
// How long a detected PR stays cached per (cwd, branch). PR state changes on
// remote events (push/merge/retarget), not on local working-tree edits, so this
// is deliberately longer than the diff cache TTL and is NOT invalidated by the
// git-dirty signal. The branch is part of the cache key, so switching branches
// naturally misses and refetches.
export const GIT_PR_CACHE_TTL_MS = 60_000;

// "Branch" diff mode compares the working tree against a base branch (via
// merge-base). The GitHub REST API is consulted to discover the current branch's
// PR base; it can hit the network, so any failure degrades to the local
// default-branch heuristic.
// Upper bound on the ref a client may pass as the comparison base. Git refs are
// already short; this just caps a hostile/garbage value before it reaches git.
export const GIT_MAX_REF_LENGTH = 255;
// Cap the branch list returned for the base-branch picker so a repo with
// thousands of remote refs can't bloat the response.
export const GIT_MAX_BRANCHES = 500;
// Safety ceiling on a single git subprocess: kills a hung invocation (a
// pathological repo, or git blocked on something GIT_TERMINAL_PROMPT=0 didn't
// suppress) so the daemon's event loop can't be held indefinitely.
export const GIT_SPAWN_TIMEOUT_MS = 30_000;

// Per-repo worktree preferences (~/.localterm/worktree-configs/<repo-id>.json):
// the setup script to run in each fresh worktree, the custom "Open in…"
// launcher commands, and the default base ref new worktrees branch from.
// Keyed by repo-id (a hash of the main worktree's absolute path) so the config
// is stable regardless of the folder name auto-created worktrees land under.
export const WORKTREE_CONFIG_FILE_VERSION = 1;
export const WORKTREE_CONFIG_DIRNAME = "worktree-configs";
export const REPO_MARKER_FILENAME = ".localterm-repo-id";
export const REPO_ID_HASH_LENGTH = 12;
export const PROJECT_FOLDER_HASH_LENGTH = 6;
export const MAX_PROJECT_FOLDER_ATTEMPTS = 100;
export const MAX_WORKTREE_NAME_ATTEMPTS = 50;
// A setup script can be longer than a one-shot automation command (it may chain
// env copy, install, db migrate, …), but it is injected into a new terminal
// tab via the `?cmd=` query param, so it must stay well under the URL/header
// limit. 8 KiB covers realistic bootstrap one-liners with room to spare.
export const MAX_WORKTREE_SETUP_SCRIPT_LENGTH = 8192;
// "Open in…" custom launcher commands appended to each non-current worktree row
// (e.g. `code .`, `zed .`, `fork .`). Capped so the row menu stays legible.
export const MAX_WORKTREE_OPEN_IN_COMMANDS = 20;
export const MAX_WORKTREE_OPEN_IN_COMMAND_LENGTH = 1024;
export const MAX_WORKTREE_OPEN_IN_LABEL_LENGTH = 64;
export const MAX_WORKTREE_OPEN_IN_ID_LENGTH = 64;
// `.worktreeinclude` (gitignore-syntax) copies gitignored files from the main
// worktree into each fresh worktree so a new checkout is immediately usable
// (.env, config/secrets.json, …). Tracked files are never copied.
export const WORKTREEINCLUDE_FILENAME = ".worktreeinclude";
export const MAX_WORKTREEINCLUDE_FILES = 500;
export const MAX_WORKTREEINCLUDE_TOTAL_BYTES = 50 * 1024 * 1024;
// Sweep removes stale, clean auto-created worktrees so the shared
// ~/.localterm/worktrees/<project>/ dir doesn't accumulate orphans. A worktree
// is eligible only if it is older than this many days AND has no uncommitted
// changes, no untracked files, and no commits not on a remote-tracking branch.
// Worktrees the user created manually (outside the shared dir) are never swept.
export const WORKTREE_SWEEP_MAX_AGE_DAYS = 30;
export const WORKTREE_SWEEP_BATCH_LIMIT = 100;
// `git fetch` for a PR-based worktree (pull/<N>/head) and the freshness fetch
// for base-ref "fresh" are bounded by the regular git timeout, but a PR number
// is still validated against a generous ceiling before it reaches git.
export const MAX_WORKTREE_PR_NUMBER = 1_000_000;
// A launcher command run by the "Open in…" menu. Spawned detached via the user's
// login shell so rc-sourced PATH entries (nvm, brew, editor CLIs) resolve; the
// spawn is fire-and-forget (output discarded) since these are GUI launches.
export const MAX_LAUNCH_COMMAND_LENGTH = 4096;

export const HTTP_STATUS_CREATED = 201;

export const MS_PER_MINUTE = 60_000;

export const MAX_AUTOMATIONS = 100;
export const MAX_AUTOMATION_NAME_LENGTH = 120;
export const MAX_AUTOMATION_COMMAND_LENGTH = 4096;
export const MAX_CRON_EXPRESSION_LENGTH = 256;
// v1 stored a raw cron string + a single lastRun. v2 stores a structured
// schedule (with a derived cron computed on the fly), a run-count limit, a
// lifecycle, and a capped run-history array. v3 wraps the schedule in a
// top-level `trigger` union so an automation can fire on a schedule OR when a
// folder changes. AutomationStore.load() migrates v1/v2 -> v3 in place on first
// boot so existing automations are never lost.
export const AUTOMATIONS_FILE_VERSION = 3;
// Largest "stop after N runs" budget. Generous — a limit is opt-in; the common
// case is "forever".
export const AUTOMATION_RUN_LIMIT_MAX = 100_000;
// Per-automation run-history ring. Newest-first; appendRun trims to this. At
// MAX_AUTOMATIONS the whole history file stays around 1 MB in the worst case.
export const AUTOMATION_RUN_HISTORY_CAP = 50;
// Most-recent "skipped" entries reconstructed per automation per outage. A
// frequent schedule (every minute) over a multi-day sleep would otherwise
// record thousands of skips and evict every real run from the ring.
export const AUTOMATION_DOWNTIME_RECONCILE_CAP = 10;
// A "multiple times a day" schedule compiles to one cron per distinct time.
export const MAX_AUTOMATION_TIMES_PER_DAY = 12;
// Downtime shorter than this is treated as a clean restart (no reconciliation):
// the daemon writes its heartbeat ~once a minute, so a same-minute bounce must
// not manufacture "skipped" entries.
export const AUTOMATION_RECONCILE_MIN_DOWNTIME_MS = 90_000;
// Cap how far back startup reconciliation enumerates missed occurrences. Bounds
// the work for a frequent (every-minute) schedule after a long outage; we keep
// only the most-recent AUTOMATION_DOWNTIME_RECONCILE_CAP per automation anyway.
export const AUTOMATION_RECONCILE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const DAEMON_HEARTBEAT_FILE_VERSION = 1;
// Ticks land just past the minute boundary so a timer that fires marginally
// early can never evaluate the previous minute twice.
export const AUTOMATION_TICK_ALIGNMENT_DELAY_MS = 50;
// A launched run that no browser tab claims within this window is marked
// "missed" (browser closed, headless host, open() failed silently).
export const AUTOMATION_PENDING_RUN_EXPIRY_MS = 5 * 60 * 1000;
// Quiet period after the last filesystem event before a folder-watch trigger
// fires. Coalesces an event storm (one editor save emits several events; a
// build emits thousands) into a single run. Trailing-edge: the timer resets on
// every event and fires once the directory settles.
export const AUTOMATION_WATCH_DEBOUNCE_MS = 500;
// After a watch-triggered run finishes, the manager keeps the in-flight guard
// on for this long before accepting new events. Prevents a command that
// writes/deletes files in the watched directory (e.g. ffmpeg converting .mov
// to .mp4 and deleting the original) from retriggering itself immediately.
// Events during the grace window are dropped (not queued). 1 second covers
// the observed ~50ms post-exit event lag with a comfortable margin.
export const AUTOMATION_WATCH_POST_RUN_GRACE_MS = 1_000;
// Quiet period after the last session event before an event-triggered automation
// fires. Coalesces a burst of rapid events (e.g. foreground changes during
// process startup, cwd + git-dirty on the same cd) into a single run.
// Trailing-edge: the timer resets on every matching event and fires once the
// session settles.
export const AUTOMATION_EVENT_DEBOUNCE_MS = 500;
// Covers schedules that only fire on Feb 29 (the rarest valid cron target).
export const CRON_NEXT_OCCURRENCE_SCAN_LIMIT_DAYS = 1466;
export const MAX_AUTOMATION_EXIT_CODE_DIGITS = 4;
export const MAX_AUTOMATION_WATCH_FILTER_LENGTH = 255;

export const WS_READY_STATE_OPEN = 1;
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_BACKPRESSURE = 4429;
export const WS_CLOSE_CAPACITY_REACHED = 4503;
