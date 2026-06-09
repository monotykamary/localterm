import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE_ERROR,
  STOP_COMMAND,
  getFriendlyUrl,
} from "./constants.js";

interface InvalidPortError {
  kind: "invalid-port";
  code: "E_LT_CLI_INVALID_PORT";
  severity: "error";
  raw: string;
  reason: string;
}

interface InvalidHostError {
  kind: "invalid-host";
  code: "E_LT_CLI_INVALID_HOST";
  severity: "error";
  host: string;
}

interface AlreadyRunningError {
  kind: "already-running";
  code: "E_LT_CLI_ALREADY_RUNNING";
  severity: "warning";
  pid: number;
  port: number;
}

interface StalePortFileError {
  kind: "stale-port-file";
  code: "E_LT_CLI_STALE_PORT_FILE";
  severity: "warning";
  pid: number;
}

interface DaemonSpawnFailedError {
  kind: "daemon-spawn-failed";
  code: "E_LT_CLI_DAEMON_SPAWN_FAILED";
  severity: "error";
  execPath: string;
  logPath: string;
}

interface DaemonDiedError {
  kind: "daemon-died";
  code: "E_LT_CLI_DAEMON_DIED";
  severity: "error";
  pid: number;
  logPath: string;
}

interface DaemonReadyTimeoutError {
  kind: "daemon-ready-timeout";
  code: "E_LT_CLI_DAEMON_READY_TIMEOUT";
  severity: "warning";
  pid: number;
  waitedMs: number;
  logPath: string;
}

interface ServerStartFailedError {
  kind: "server-start-failed";
  code: "E_LT_CLI_SERVER_START_FAILED";
  severity: "error";
  cause: Error;
}

interface PidNotOursError {
  kind: "pid-not-ours";
  code: "E_LT_CLI_PID_NOT_OURS";
  severity: "warning";
  pid: number;
}

interface SignalFailedError {
  kind: "signal-failed";
  code: "E_LT_CLI_SIGNAL_FAILED";
  severity: "error";
  pid: number;
  cause: Error;
}

interface HealthCheckFailedError {
  kind: "health-check-failed";
  code: "E_LT_CLI_HEALTH_CHECK_FAILED";
  severity: "warning";
  pid: number;
  port: number;
  cause: Error;
}

export type CliError =
  | InvalidPortError
  | InvalidHostError
  | AlreadyRunningError
  | StalePortFileError
  | DaemonSpawnFailedError
  | DaemonDiedError
  | DaemonReadyTimeoutError
  | ServerStartFailedError
  | PidNotOursError
  | SignalFailedError
  | HealthCheckFailedError;

export type CliErrorCode = CliError["code"];
export type CliErrorKind = CliError["kind"];

export const cliError = {
  invalidPort: (raw: string, reason: string): InvalidPortError => ({
    kind: "invalid-port",
    code: "E_LT_CLI_INVALID_PORT",
    severity: "error",
    raw,
    reason,
  }),
  invalidHost: (host: string): InvalidHostError => ({
    kind: "invalid-host",
    code: "E_LT_CLI_INVALID_HOST",
    severity: "error",
    host,
  }),
  alreadyRunning: (pid: number, port: number): AlreadyRunningError => ({
    kind: "already-running",
    code: "E_LT_CLI_ALREADY_RUNNING",
    severity: "warning",
    pid,
    port,
  }),
  stalePortFile: (pid: number): StalePortFileError => ({
    kind: "stale-port-file",
    code: "E_LT_CLI_STALE_PORT_FILE",
    severity: "warning",
    pid,
  }),
  daemonSpawnFailed: (execPath: string, logPath: string): DaemonSpawnFailedError => ({
    kind: "daemon-spawn-failed",
    code: "E_LT_CLI_DAEMON_SPAWN_FAILED",
    severity: "error",
    execPath,
    logPath,
  }),
  daemonDied: (pid: number, logPath: string): DaemonDiedError => ({
    kind: "daemon-died",
    code: "E_LT_CLI_DAEMON_DIED",
    severity: "error",
    pid,
    logPath,
  }),
  daemonReadyTimeout: (
    pid: number,
    waitedMs: number,
    logPath: string,
  ): DaemonReadyTimeoutError => ({
    kind: "daemon-ready-timeout",
    code: "E_LT_CLI_DAEMON_READY_TIMEOUT",
    severity: "warning",
    pid,
    waitedMs,
    logPath,
  }),
  serverStartFailed: (cause: Error): ServerStartFailedError => ({
    kind: "server-start-failed",
    code: "E_LT_CLI_SERVER_START_FAILED",
    severity: "error",
    cause,
  }),
  pidNotOurs: (pid: number): PidNotOursError => ({
    kind: "pid-not-ours",
    code: "E_LT_CLI_PID_NOT_OURS",
    severity: "warning",
    pid,
  }),
  signalFailed: (pid: number, cause: Error): SignalFailedError => ({
    kind: "signal-failed",
    code: "E_LT_CLI_SIGNAL_FAILED",
    severity: "error",
    pid,
    cause,
  }),
  healthCheckFailed: (pid: number, port: number, cause: Error): HealthCheckFailedError => ({
    kind: "health-check-failed",
    code: "E_LT_CLI_HEALTH_CHECK_FAILED",
    severity: "warning",
    pid,
    port,
    cause,
  }),
};

const exhaustivenessGuard = (impossible: never): never => {
  throw new Error(`unhandled CliError variant: ${JSON.stringify(impossible)}`);
};

export const formatCliError = (error: CliError): string => {
  switch (error.kind) {
    case "invalid-port":
      return `invalid --port '${error.raw}': ${error.reason}`;
    case "invalid-host":
      return `refusing to bind '${error.host}'. localterm accepts loopback hosts (127.0.0.1, localhost, *.localhost, ::1) or explicit network addresses (0.0.0.0).`;
    case "already-running":
      return `localterm is already running (pid ${error.pid}, port ${error.port}).`;
    case "stale-port-file":
      return `localterm pid ${error.pid} is alive but the port file is missing.`;
    case "daemon-spawn-failed":
      return `failed to spawn ${error.execPath} — check that node is on PATH.`;
    case "daemon-died":
      return `daemon died during startup.`;
    case "daemon-ready-timeout":
      return `daemon spawned (pid ${error.pid}) but didn't bind a port within ${error.waitedMs}ms.`;
    case "server-start-failed":
      return `failed to start: ${error.cause.message}`;
    case "pid-not-ours":
      return `pid ${error.pid} is alive but does not look like a localterm process. refusing to signal an unrelated process.`;
    case "signal-failed":
      return `failed to signal pid ${error.pid}: ${error.cause.message}`;
    case "health-check-failed":
      return `pid ${error.pid} is alive but health check failed: ${error.cause.message}`;
    default:
      return exhaustivenessGuard(error);
  }
};

export const hintForCliError = (error: CliError): string | null => {
  switch (error.kind) {
    case "already-running":
      return `Open ${getFriendlyUrl(error.port)} or run \`${STOP_COMMAND}\`.`;
    case "stale-port-file":
      return `Run \`localterm stop\` and try again.`;
    case "daemon-spawn-failed":
      return `tail logs: ${error.logPath}`;
    case "daemon-died":
      return `tail logs: ${error.logPath}`;
    case "daemon-ready-timeout":
      return `tail logs: ${error.logPath}`;
    case "invalid-port":
    case "invalid-host":
    case "server-start-failed":
    case "pid-not-ours":
    case "signal-failed":
    case "health-check-failed":
      return null;
    default:
      return exhaustivenessGuard(error);
  }
};

export const exitCodeForCliError = (error: CliError): number => {
  switch (error.kind) {
    case "invalid-port":
    case "invalid-host":
      return EXIT_USAGE_ERROR;
    case "already-running":
    case "stale-port-file":
    case "pid-not-ours":
      return EXIT_OK;
    case "daemon-spawn-failed":
    case "daemon-died":
    case "daemon-ready-timeout":
    case "server-start-failed":
    case "signal-failed":
    case "health-check-failed":
      return EXIT_FAILURE;
    default:
      return exhaustivenessGuard(error);
  }
};

export class CliErrorException extends Error {
  readonly error: CliError;
  constructor(error: CliError) {
    super(formatCliError(error), {
      cause: "cause" in error ? error.cause : undefined,
    });
    this.name = "CliErrorException";
    this.error = error;
  }
}

export const isCliErrorException = (value: unknown): value is CliErrorException =>
  value instanceof CliErrorException;
