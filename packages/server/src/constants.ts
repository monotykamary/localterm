export const DEFAULT_PORT = 3417;
export const DEFAULT_HOST = "0.0.0.0";
export const DEFAULT_COLS = 120;
export const DEFAULT_ROWS = 32;
export const DEFAULT_SHELL_FALLBACK = "/bin/sh";

export const TERM_TYPE = "xterm-256color";
export const COLORTERM_VALUE = "truecolor";

export const TITLE_POLL_INTERVAL_MS = 500;
export const CWD_RESOLVE_TIMEOUT_MS = 250;
export const CWD_RESOLVE_BACKOFF_MS = 30_000;
export const CWD_RESOLVE_COOLDOWN_MS = 5_000;
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
];

export const MAX_INPUT_BYTES = 64 * 1024;
export const MAX_OUTPUT_BYTES = 1 * 1024 * 1024;
export const MAX_FOREGROUND_LENGTH = 256;
export const MAX_TITLE_LENGTH = 4 * 1024;
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

// Heartbeat: send a WS ping every N ms; if no pong arrives within the timeout
// we tear down the socket. Without this, half-open connections (laptop sleep,
// VPN dropout, kernel‑side TCP keepalives at 2h+) wedge the session — the
// server keeps a dead PTY tied to a phantom client and the browser eventually
// trips its own write error and shows "Shell ended" with no idea why.
export const WS_HEARTBEAT_INTERVAL_MS = 20_000;
export const WS_HEARTBEAT_TIMEOUT_MS = 60_000;
// Hard ceiling for server.stop() — clients get terminated, then the http
// server is given this long to actually close before we resolve anyway. Keeps
// the daemon's SIGTERM path bounded so the CLI's force-exit fallback never
// fires for normal shutdowns.
export const SERVER_STOP_GRACE_MS = 1_500;

export const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
]);

export const HTTP_STATUS_NOT_FOUND = 404;

export const WS_READY_STATE_OPEN = 1;
export const WS_CLOSE_POLICY_VIOLATION = 1008;
export const WS_CLOSE_BACKPRESSURE = 4429;
export const WS_CLOSE_CAPACITY_REACHED = 4503;
