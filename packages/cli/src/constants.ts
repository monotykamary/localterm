export const FORCE_EXIT_TIMEOUT_MS = 3000;
export const STOP_POLL_INTERVAL_MS = 100;
export const STOP_MAX_WAIT_MS = 5000;
export const DAEMON_PROBE_INTERVAL_MS = 100;
export const DAEMON_PROBE_MAX_WAIT_MS = 5000;
export const VERIFY_PID_TIMEOUT_MS = 1000;

export const MIN_TCP_PORT = 1;
export const MAX_TCP_PORT = 65535;

export const FRIENDLY_HOSTNAME = "localterm.localhost";
export const STOP_COMMAND = "npx @monotykamary/localterm@latest stop";
export const DAEMON_CHILD_ENV_FLAG = "LOCALTERM_DAEMON_CHILD";
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

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE_ERROR = 2;

export const getFriendlyUrl = (port: number): string => `http://${FRIENDLY_HOSTNAME}:${port}`;
