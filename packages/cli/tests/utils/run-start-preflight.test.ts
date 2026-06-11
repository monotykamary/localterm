import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as state from "../../src/state.js";
import * as verify from "../../src/utils/verify-pid-is-localterm.js";
import { runStartPreflight } from "../../src/utils/run-start-preflight.js";

beforeEach(() => {
  vi.spyOn(state, "readPid").mockReturnValue(null);
  vi.spyOn(state, "readPort").mockReturnValue(null);
  vi.spyOn(state, "isAlive").mockReturnValue(false);
  vi.spyOn(state, "clearPid").mockReturnValue(undefined);
  vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue("ours");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runStartPreflight", () => {
  it("returns null when no daemon state is present", async () => {
    expect(await runStartPreflight()).toBeNull();
  });

  it("reports already-running when a live daemon's pid + port file are both present", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    expect(await runStartPreflight()).toEqual(
      expect.objectContaining({
        kind: "already-running",
        code: "E_LT_CLI_ALREADY_RUNNING",
        severity: "warning",
        pid: 12345,
        port: 3417,
      }),
    );
  });

  it("reports stale-port-file when the daemon is alive but the port file is missing", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readPort").mockReturnValue(null);
    expect(await runStartPreflight()).toEqual(
      expect.objectContaining({
        kind: "stale-port-file",
        code: "E_LT_CLI_STALE_PORT_FILE",
        severity: "warning",
        pid: 12345,
      }),
    );
  });

  it("clears the pid and returns null when the recorded pid is dead", async () => {
    const clearSpy = vi.spyOn(state, "clearPid");
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(false);
    expect(await runStartPreflight()).toBeNull();
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("clears pid and returns null when pid is confirmed not ours", async () => {
    const clearSpy = vi.spyOn(state, "clearPid");
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue("not-ours");
    expect(await runStartPreflight()).toBeNull();
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("treats unknown verification as ours and reports already-running", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue("unknown");
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    expect(await runStartPreflight()).toEqual(
      expect.objectContaining({
        kind: "already-running",
        pid: 12345,
        port: 3417,
      }),
    );
  });
});
