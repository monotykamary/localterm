import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import * as state from "../../src/state.js";

const { openMock } = vi.hoisted(() => ({ openMock: vi.fn(async () => undefined) }));

vi.mock("open", () => ({ default: openMock }));

vi.mock("../../src/utils/portless.js", async () => {
  const actual = await import("../../src/utils/portless.js");
  return {
    ...actual,
    // Tailnet-fronted daemon: the remote `url` is the tailnet origin, while
    // `localUrl` is the daemon-local portless surface a local attach tab
    // should open at instead of riding a flapping `tailscale serve`.
    resolveDaemonUrl: vi.fn(async () => ({
      url: "https://toms-macbook-air.taild0936.ts.net",
      localUrl: "https://localterm.localhost",
      surface: "tailnet" as const,
      warnings: [],
    })),
  };
});

const { runSessionAttach } = await import("../../src/commands/session.js");

const SESSION_ID = "413bc0c9-5eec-4857-9dc8-7d38e19936a9";

describe("runSessionAttach", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
    openMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens at the daemon-local portless surface, not the tailnet remote surface", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    await runSessionAttach(SESSION_ID);
    expect(openMock).toHaveBeenCalledOnce();
    expect(openMock).toHaveBeenCalledWith(`https://localterm.localhost/?sid=${SESSION_ID}`);
    expect(openMock).not.toHaveBeenCalledWith(expect.stringContaining("ts.net"));
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining(`https://localterm.localhost/?sid=${SESSION_ID}`),
    );
  });

  it("reports the daemon down and opens no tab when no port is recorded", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(null);
    await runSessionAttach(SESSION_ID);
    expect(openMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
