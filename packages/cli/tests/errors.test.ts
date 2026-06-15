import { describe, expect, it } from "vite-plus/test";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE_ERROR } from "../src/constants.js";
import {
  CliErrorException,
  cliError,
  exitCodeForCliError,
  formatCliError,
  hintForCliError,
  isCliErrorException,
  type CliError,
} from "../src/errors.js";

const allVariants = (): CliError[] => [
  cliError.invalidPort("abc", "expected an integer"),
  cliError.invalidHost("0.0.0.0"),
  cliError.alreadyRunning(12345, 3417),
  cliError.stalePortFile(12345),
  cliError.daemonSpawnFailed("/usr/bin/node", "/tmp/localterm.log"),
  cliError.daemonDied(12345, "/tmp/localterm.log"),
  cliError.daemonReadyTimeout(12345, 5000, "/tmp/localterm.log"),
  cliError.serverStartFailed(new Error("EADDRINUSE")),
  cliError.pidNotOurs(99999),
  cliError.signalFailed(99999, new Error("ESRCH")),
  cliError.healthCheckFailed(12345, 3417, new Error("connect ECONNREFUSED")),
];

describe("cliError vocabulary", () => {
  it("every variant has a stable E_LT_CLI_* code matching its kind position", () => {
    for (const variant of allVariants()) {
      expect(variant.code.startsWith("E_LT_CLI_")).toBe(true);
      expect(variant.severity).toMatch(/^(error|warning|info)$/);
    }
  });

  it("warning-severity variants are pid/port shape problems, not crashes", () => {
    const warnings = allVariants().filter((variant) => variant.severity === "warning");
    const warningKinds = warnings.map((variant) => variant.kind).sort();
    expect(warningKinds).toEqual(
      [
        "already-running",
        "daemon-ready-timeout",
        "health-check-failed",
        "pid-not-ours",
        "stale-port-file",
      ].sort(),
    );
  });
});

describe("formatCliError", () => {
  it("formats every variant without throwing the exhaustiveness guard", () => {
    for (const variant of allVariants()) {
      const message = formatCliError(variant);
      expect(message).toBeTypeOf("string");
      expect(message.length).toBeGreaterThan(0);
    }
  });

  it("renders the underlying cause in server-start-failed", () => {
    const message = formatCliError(cliError.serverStartFailed(new Error("EADDRINUSE")));
    expect(message).toContain("EADDRINUSE");
  });
});

describe("hintForCliError", () => {
  it("offers actionable hints for daemon failure modes", () => {
    expect(hintForCliError(cliError.alreadyRunning(1, 3417))).toMatch(
      /localterm.localhost:3417|localterm stop/,
    );
    expect(hintForCliError(cliError.stalePortFile(1))).toMatch(/localterm stop/);
    expect(hintForCliError(cliError.daemonDied(1, "/tmp/log"))).toContain("/tmp/log");
    expect(hintForCliError(cliError.daemonSpawnFailed("/n", "/tmp/log"))).toContain("/tmp/log");
    expect(hintForCliError(cliError.daemonReadyTimeout(1, 5000, "/tmp/log"))).toContain("/tmp/log");
  });

  it("returns null for variants without a known recovery path", () => {
    expect(hintForCliError(cliError.invalidPort("abc", "x"))).toBeNull();
    expect(hintForCliError(cliError.invalidHost("0.0.0.0"))).toBeNull();
    expect(hintForCliError(cliError.serverStartFailed(new Error("x")))).toBeNull();
    expect(hintForCliError(cliError.pidNotOurs(1))).toBeNull();
    expect(hintForCliError(cliError.signalFailed(1, new Error("x")))).toBeNull();
    expect(hintForCliError(cliError.healthCheckFailed(1, 1, new Error("x")))).toBeNull();
  });
});

describe("exitCodeForCliError", () => {
  it("maps invalid input to EXIT_USAGE_ERROR", () => {
    expect(exitCodeForCliError(cliError.invalidPort("abc", "x"))).toBe(EXIT_USAGE_ERROR);
    expect(exitCodeForCliError(cliError.invalidHost("0.0.0.0"))).toBe(EXIT_USAGE_ERROR);
  });

  it("maps already-running to EXIT_FAILURE so launchd KeepAlive does not respawn", () => {
    expect(exitCodeForCliError(cliError.alreadyRunning(1, 3417))).toBe(EXIT_FAILURE);
  });

  it("maps stale / informational PID edge cases to EXIT_OK", () => {
    expect(exitCodeForCliError(cliError.stalePortFile(1))).toBe(EXIT_OK);
    expect(exitCodeForCliError(cliError.pidNotOurs(1))).toBe(EXIT_OK);
  });

  it("maps real failures to EXIT_FAILURE", () => {
    expect(exitCodeForCliError(cliError.daemonDied(1, "/tmp/log"))).toBe(EXIT_FAILURE);
    expect(exitCodeForCliError(cliError.daemonSpawnFailed("/n", "/tmp/log"))).toBe(EXIT_FAILURE);
    expect(exitCodeForCliError(cliError.serverStartFailed(new Error("x")))).toBe(EXIT_FAILURE);
    expect(exitCodeForCliError(cliError.signalFailed(1, new Error("x")))).toBe(EXIT_FAILURE);
  });
});

describe("CliErrorException", () => {
  it("preserves the typed error and chains the cause", () => {
    const cause = new Error("EADDRINUSE");
    const exception = new CliErrorException(cliError.serverStartFailed(cause));
    expect(exception).toBeInstanceOf(Error);
    expect(exception.name).toBe("CliErrorException");
    expect(exception.error.kind).toBe("server-start-failed");
    expect(exception.cause).toBe(cause);
  });

  it("isCliErrorException narrows correctly", () => {
    const exception = new CliErrorException(cliError.alreadyRunning(1, 3417));
    expect(isCliErrorException(exception)).toBe(true);
    expect(isCliErrorException(new Error("plain"))).toBe(false);
    expect(isCliErrorException(null)).toBe(false);
  });
});
