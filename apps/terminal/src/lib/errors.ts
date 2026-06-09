import {
  WS_CLOSE_BACKPRESSURE,
  WS_CLOSE_CAPACITY_REACHED,
  WS_CLOSE_POLICY_VIOLATION,
} from "@monotykamary/localterm-server/protocol";

interface ConnectionLostError {
  kind: "connection-lost";
  code: "E_LT_WEB_CONNECTION_LOST";
  consecutiveFailures: number;
}

interface ShellExitedError {
  kind: "shell-exited";
  code: "E_LT_WEB_SHELL_EXITED";
  exitCode: number | null;
}

interface SocketRefusedByServerError {
  kind: "socket-refused-by-server";
  code: "E_LT_WEB_SOCKET_REFUSED_BY_SERVER";
  closeCode: number;
  reason: "loopback-policy" | "session-capacity" | "backpressure" | "unknown";
}

interface FrameInvalidError {
  kind: "frame-invalid";
  code: "E_LT_WEB_FRAME_INVALID";
  stage: "json-parse" | "schema-parse";
}

interface StorageDeniedError {
  kind: "storage-denied";
  code: "E_LT_WEB_STORAGE_DENIED";
  store: "localStorage" | "sessionStorage";
  operation: "read" | "write";
}

interface ClipboardDeniedError {
  kind: "clipboard-denied";
  code: "E_LT_WEB_CLIPBOARD_DENIED";
}

export type WebError =
  | ConnectionLostError
  | ShellExitedError
  | SocketRefusedByServerError
  | FrameInvalidError
  | StorageDeniedError
  | ClipboardDeniedError;

export type WebErrorCode = WebError["code"];
export type WebErrorKind = WebError["kind"];

export const webError = {
  connectionLost: (consecutiveFailures: number): ConnectionLostError => ({
    kind: "connection-lost",
    code: "E_LT_WEB_CONNECTION_LOST",
    consecutiveFailures,
  }),
  shellExited: (exitCode: number | null): ShellExitedError => ({
    kind: "shell-exited",
    code: "E_LT_WEB_SHELL_EXITED",
    exitCode,
  }),
  socketRefusedByServer: (closeCode: number): SocketRefusedByServerError => ({
    kind: "socket-refused-by-server",
    code: "E_LT_WEB_SOCKET_REFUSED_BY_SERVER",
    closeCode,
    reason: classifyCloseCode(closeCode),
  }),
  frameInvalid: (stage: "json-parse" | "schema-parse"): FrameInvalidError => ({
    kind: "frame-invalid",
    code: "E_LT_WEB_FRAME_INVALID",
    stage,
  }),
  storageDenied: (
    store: "localStorage" | "sessionStorage",
    operation: "read" | "write",
  ): StorageDeniedError => ({
    kind: "storage-denied",
    code: "E_LT_WEB_STORAGE_DENIED",
    store,
    operation,
  }),
  clipboardDenied: (): ClipboardDeniedError => ({
    kind: "clipboard-denied",
    code: "E_LT_WEB_CLIPBOARD_DENIED",
  }),
};

const classifyCloseCode = (closeCode: number): SocketRefusedByServerError["reason"] => {
  if (closeCode === WS_CLOSE_POLICY_VIOLATION) return "loopback-policy";
  if (closeCode === WS_CLOSE_CAPACITY_REACHED) return "session-capacity";
  if (closeCode === WS_CLOSE_BACKPRESSURE) return "backpressure";
  return "unknown";
};

const exhaustivenessGuard = (impossible: never): never => {
  throw new Error(`unhandled WebError variant: ${JSON.stringify(impossible)}`);
};

const formatSocketRefused = (error: SocketRefusedByServerError): string => {
  switch (error.reason) {
    case "loopback-policy":
      return "Server refused the connection: loopback-only policy.";
    case "session-capacity":
      return "Server is at session capacity. Close another tab and try again.";
    case "backpressure":
      return "Server closed the connection: too much buffered output. Try reconnecting.";
    case "unknown":
      return `Server closed the connection (code ${error.closeCode}).`;
    default:
      return exhaustivenessGuard(error.reason);
  }
};

export const formatWebError = (error: WebError): string => {
  switch (error.kind) {
    case "connection-lost":
      return `Lost connection to localterm (${error.consecutiveFailures} failed attempts).`;
    case "shell-exited":
      return error.exitCode === null ? "Shell ended." : `Shell exited with code ${error.exitCode}.`;
    case "socket-refused-by-server":
      return formatSocketRefused(error);
    case "frame-invalid":
      return `Dropped malformed server frame (${error.stage}).`;
    case "storage-denied":
      return `${error.store} ${error.operation} denied (private mode or quota).`;
    case "clipboard-denied":
      return "Clipboard write denied. Use Cmd/Ctrl+C after selecting the text.";
    default:
      return exhaustivenessGuard(error);
  }
};

export class WebErrorException extends Error {
  readonly error: WebError;
  constructor(error: WebError) {
    super(formatWebError(error));
    this.name = "WebErrorException";
    this.error = error;
  }
}

export const isWebErrorException = (value: unknown): value is WebErrorException =>
  value instanceof WebErrorException;
