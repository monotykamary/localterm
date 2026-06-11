import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as state from "../../src/state.js";
import * as verify from "../../src/utils/verify-pid-is-localterm.js";
import * as sleepMod from "../../src/utils/sleep.js";
import { runStop } from "../../src/commands/stop.js";

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(sleepMod, "sleep").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("runStop", () => {
  it("prints 'not running' when no pid file exists", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(null);
    await runStop();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not running"));
  });

  it("clears stale pid and prints removal message when pid is dead", async () => {
    const clearSpy = vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(false);
    await runStop();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
  });

  it("refuses to signal a pid that is not localterm", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue(false);
    const clearSpy = vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStop();
    expect(process.exitCode).toBe(0);
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it("sends SIGTERM and reports stopped pid", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValueOnce(true).mockReturnValue(false);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue(true);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
    const clearSpy = vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStop();
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("stopped pid 12345"));
  });

  it("escalates to SIGKILL when SIGTERM does not kill the process", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    let postKillIsAlive = false;
    // isAlive returns true through all polling iterations
    vi.spyOn(state, "isAlive").mockImplementation(() => !postKillIsAlive);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue(true);
    const killSpy = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      // After SIGKILL, simulate the process being dead
      if (signal === "SIGKILL") postKillIsAlive = true;
      return true;
    });
    vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStop();
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGTERM");
    expect(killSpy).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("stopped pid 12345"));
  });

  it("warns when pid does not exit after SIGKILL", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue(true);
    vi.spyOn(process, "kill")
      .mockImplementationOnce(() => true)
      .mockImplementation(() => {
        throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      });
    vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStop();
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("did not exit"));
  });

  it("sets exitCode on signal failure", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(verify, "verifyPidIsLocalterm").mockResolvedValue(true);
    vi.spyOn(process, "kill").mockImplementation(() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    });
    vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStop();
    expect(process.exitCode).toBe(1);
  });
});
