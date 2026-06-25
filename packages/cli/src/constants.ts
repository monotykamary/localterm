export const FORCE_EXIT_TIMEOUT_MS = 3000;
export const STOP_POLL_INTERVAL_MS = 100;
export const STOP_MAX_WAIT_MS = 5000;
export const DAEMON_PROBE_INTERVAL_MS = 100;
export const DAEMON_PROBE_MAX_WAIT_MS = 5000;
export const VERIFY_PID_TIMEOUT_MS = 1000;

export const MIN_TCP_PORT = 1;
export const MAX_TCP_PORT = 65535;

export const FRIENDLY_HOSTNAME = "localterm.localhost";
export const PORTLESS_APP_NAME = "localterm";
export const PORTLESS_ALIAS_TIMEOUT_MS = 5_000;
export const PORTLESS_SERVICE_TIMEOUT_MS = 30_000;
export const TAILSCALE_SERVE_TIMEOUT_MS = 30_000;
export const TAILSCALE_STATUS_TIMEOUT_MS = 5_000;
export const PROXY_LIVENESS_PROBE_TIMEOUT_MS = 300;
export const TAILSCALE_HTTPS_PORT = 443;
export const TAILSCALE_BINARY_PATHS = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
  "/usr/bin/tailscale",
] as const;
export const TAILSCALE_HTTPS_SETTINGS_URL = "https://login.tailscale.com/admin/settings/features";
export const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
export const STOP_COMMAND = "npx @monotykamary/localterm@latest stop";
export const DAEMON_CHILD_ENV_FLAG = "LOCALTERM_DAEMON_CHILD";
export const RESTART_DAEMON_ENV_FLAG = "LOCALTERM_RESTART_DAEMON";
/**
 * Distinctive process name set on the daemon at startup (via `process.title`).
 * `localterm stop` verifies the recorded pid's kernel-reported comm matches
 * this exact string before sending SIGTERM, so we never signal an unrelated
 * process that happens to live at the recycled pid.
 *
 * Length stays under 15 chars so Linux's PR_SET_NAME (limited to TASK_COMM_LEN
 * = 16 including the null) doesn't truncate the value differently than macOS.
 */
export const DAEMON_PROCESS_TITLE = "localtermd";

export const LAUNCHD_LABEL = "com.monotykamary.localterm";
export const LAUNCHD_PLIST_FILENAME = `${LAUNCHD_LABEL}.plist`;

// Minimal system PATH baked into the launchd plist for the daemon. The daemon
// needs only system binaries (caffeinate, ps, security, xattr, codesign) plus
// `portless` (its dir is appended at install time); `git` runs via /usr/bin/git
// (Apple-signed, cached). Baking the full user PATH leaks homebrew/mise binaries
// that syspolicyd re-assesses per PTY — a launchd agent has no GUI provenance.
export const DAEMON_BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
export const PORTLESS_RESOLVE_TIMEOUT_MS = 5_000;

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE_ERROR = 2;

export const RESTART_BIND_RETRY_INTERVAL_MS = 200;
export const RESTART_BIND_RETRY_MAX_MS = 5000;

export const getFriendlyUrl = (port: number): string => `http://${FRIENDLY_HOSTNAME}:${port}`;

export const getPortlessUrl = (): string => `https://${FRIENDLY_HOSTNAME}`;

export const getDirectUrl = (port: number, host = "127.0.0.1"): string => `http://${host}:${port}`;
