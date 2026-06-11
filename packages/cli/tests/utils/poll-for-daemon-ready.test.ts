import { describe, expect, it, vi } from "vite-plus/test";
import { pollForDaemonReady } from "../../src/utils/poll-for-daemon-ready.js";

const STANDARD_OPTIONS = {
  childPid: 12345,
  intervalMs: 10,
  maxWaitMs: 100,
  logPath: "/tmp/localterm.log",
};

const noopSleep = (): Promise<void> => Promise.resolve();
const neverHealthy = (): Promise<boolean> => Promise.resolve(false);
const noopReadHost = (): string | null => "127.0.0.1";

const noopProbeHealth = (): Promise<boolean> => neverHealthy();

describe("pollForDaemonReady", () => {
  it("resolves with the new port once a different value appears", async () => {
    let tick = 0;
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: null,
      isAlive: () => true,
      readPort: () => {
        tick += 1;
        return tick < 3 ? null : 4242;
      },
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: noopProbeHealth,
    });
    expect(result).toEqual({ ok: true, port: 4242 });
  });

  it("rejects a stale port that matches initialPort and keeps polling", async () => {
    const stalePort = 3417;
    const newPort = 5555;
    let tick = 0;
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: stalePort,
      isAlive: () => true,
      readPort: () => {
        tick += 1;
        if (tick < 4) return stalePort;
        return newPort;
      },
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: noopProbeHealth,
    });
    expect(result).toEqual({ ok: true, port: newPort });
  });

  it("returns a daemon-died CliError when the child process disappears mid-poll", async () => {
    let tick = 0;
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: null,
      isAlive: () => {
        tick += 1;
        return tick < 3;
      },
      readPort: () => null,
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: noopProbeHealth,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("daemon-died");
      expect(result.error.code).toBe("E_LT_CLI_DAEMON_DIED");
    }
  });

  it("returns a daemon-ready-timeout CliError when the deadline expires without a fresh port", async () => {
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: null,
      isAlive: () => true,
      readPort: () => null,
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: noopProbeHealth,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("daemon-ready-timeout");
      expect(result.error.code).toBe("E_LT_CLI_DAEMON_READY_TIMEOUT");
    }
  });

  it("resolves immediately on the first tick when a fresh port is already present", async () => {
    const isAlive = vi.fn(() => true);
    const readPort = vi.fn(() => 7777);
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: null,
      isAlive,
      readPort,
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: noopProbeHealth,
    });
    expect(result).toEqual({ ok: true, port: 7777 });
    expect(isAlive).toHaveBeenCalledOnce();
    expect(readPort).toHaveBeenCalledOnce();
  });

  it("polls roughly maxWaitMs / intervalMs times before timing out", async () => {
    const sleepSpy = vi.fn(noopSleep);
    await pollForDaemonReady({
      childPid: 1,
      initialPort: null,
      intervalMs: 10,
      maxWaitMs: 100,
      logPath: "/tmp/localterm.log",
      isAlive: () => true,
      readPort: () => null,
      readHost: noopReadHost,
      sleep: sleepSpy,
      probeHealth: noopProbeHealth,
    });
    expect(sleepSpy).toHaveBeenCalledTimes(10);
  });

  it("resolves when port file matches initialPort but health probe succeeds", async () => {
    const stalePort = 3417;
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: stalePort,
      isAlive: () => true,
      readPort: () => stalePort,
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: () => Promise.resolve(true),
    });
    expect(result).toEqual({ ok: true, port: stalePort });
  });

  it("continues polling when port file matches and health probe fails", async () => {
    const stalePort = 3417;
    let tick = 0;
    const result = await pollForDaemonReady({
      ...STANDARD_OPTIONS,
      initialPort: stalePort,
      isAlive: () => true,
      readPort: () => stalePort,
      readHost: noopReadHost,
      sleep: noopSleep,
      probeHealth: () => {
        tick += 1;
        return Promise.resolve(tick >= 3);
      },
    });
    expect(result).toEqual({ ok: true, port: stalePort });
  });
});
