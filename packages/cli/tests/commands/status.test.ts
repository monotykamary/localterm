import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as state from "../../src/state.js";

vi.mock("../../src/utils/portless.js", async () => {
  const actual = await import("../../src/utils/portless.js");
  return {
    ...actual,
    resolveDaemonUrl: vi.fn(async () => ({
      url: "http://127.0.0.1:3417",
      localUrl: "http://127.0.0.1:3417",
      surface: "loopback" as const,
      warnings: [],
    })),
  };
});

const { runStatus } = await import("../../src/commands/status.js");

let consoleLogSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runStatus", () => {
  it("prints 'not running' when no pid or port file exists", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(null);
    vi.spyOn(state, "readPort").mockReturnValue(null);
    await runStatus();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not running"));
  });

  it("clears stale port file when pid is missing but port file exists", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(null);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    const clearSpy = vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStatus();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("stale"));
  });

  it("reports dead pid as stale state", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(false);
    const clearSpy = vi.spyOn(state, "clearPid").mockReturnValue(undefined);
    await runStatus();
    expect(clearSpy).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("gone"));
  });

  it("reports 'port unknown' when pid is alive but port file is missing", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(null);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    await runStatus();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("port is unknown"));
  });

  it("calls the health endpoint and prints running status", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessions: 2,
          cdp: { connected: true, browser: "Google Chrome" },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
    await runStatus();
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:3417/api/health");
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("running"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("pid:      12345"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("port:     3417"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("sessions: 2"));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("cdp:      "));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("background + closeable via Google Chrome"),
    );
  });

  it("falls back to 127.0.0.1 when host file is missing", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readHost").mockReturnValue(null);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, sessions: 0, cdp: { connected: false } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runStatus();
    expect(fetchSpy).toHaveBeenCalledWith("http://127.0.0.1:3417/api/health");
  });

  it("prints the OS-opener fallback when CDP is not connected", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, sessions: 1, cdp: { connected: false } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runStatus();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("OS opener"));
  });

  it("prints CDP disabled when the daemon reports no CDP path", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, sessions: 0, cdp: null }), {
        headers: { "content-type": "application/json" },
      }),
    );
    await runStatus();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("cdp:      "));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("sets exitCode when health check fails", async () => {
    vi.spyOn(state, "readPid").mockReturnValue(12345);
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "isAlive").mockReturnValue(true);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    await runStatus();
    expect(process.exitCode).toBe(1);
  });
});
