export const DEFAULT_PORT = 3417;
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 32;
export const DEFAULT_SHELL_FALLBACK = "/bin/sh";

export const TERM_TYPE = "xterm-256color";
export const COLORTERM_VALUE = "truecolor";
export const LOCALTERM_VALUE = "1";

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
  "__LOCALTERM_ORIG_ZDOTDIR",
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
export const GIT_COMMAND_TIMEOUT_MS = 10_000;
// `git diff` of a large working tree can legitimately produce tens of MB;
// execFile kills the child past maxBuffer, which we degrade into a
// "patches omitted" response rather than an error.
export const GIT_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
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

export const WS_READY_STATE_OPEN = 1;
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_BACKPRESSURE = 4429;
export const WS_CLOSE_CAPACITY_REACHED = 4503;
