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

const { runSessionAttach, runSessionCurrent } = await import("../../src/commands/session.js");

const SESSION_ID = "413bc0c9-5eec-4857-9dc8-7d38e19936a9";
const SHORT_ID = SESSION_ID.slice(0, 8);

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

describe("runSessionCurrent", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let savedSessionIdEnv: string | undefined;

  const liveSession = {
    id: SESSION_ID,
    pid: 12345,
    shell: "/bin/zsh",
    shellName: "zsh",
    cwd: "/Users/me/proj",
    title: "proj",
    createdAt: 0,
    lastOutputAt: 0,
    clients: 2,
    state: "running",
    pinned: false,
  };

  const stubLiveResponse = (): void => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ session: liveSession }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
  };

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
    savedSessionIdEnv = process.env.LOCALTERM_SESSION_ID;
    delete process.env.LOCALTERM_SESSION_ID;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (savedSessionIdEnv === undefined) delete process.env.LOCALTERM_SESSION_ID;
    else process.env.LOCALTERM_SESSION_ID = savedSessionIdEnv;
  });

  it("reports not-in-session and exits 1 when LOCALTERM_SESSION_ID is unset", async () => {
    await runSessionCurrent({ json: false });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("not running inside a localterm session"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("emits a JSON error object with --json when not in a session", async () => {
    await runSessionCurrent({ json: true });
    expect(JSON.parse(consoleLogSpy.mock.calls[0][0] as string)).toEqual({
      error: "not_in_session",
    });
    expect(process.exitCode).toBe(1);
  });

  it("resolves the live session and prints an enriched line", async () => {
    process.env.LOCALTERM_SESSION_ID = SESSION_ID;
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    stubLiveResponse();
    await runSessionCurrent({ json: false });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(SHORT_ID));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("zsh"));
    expect(process.exitCode).toBeUndefined();
  });

  it("emits the full live session object with --json", async () => {
    process.env.LOCALTERM_SESSION_ID = SESSION_ID;
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    stubLiveResponse();
    await runSessionCurrent({ json: true });
    expect(JSON.parse(consoleLogSpy.mock.calls[0][0] as string)).toEqual(liveSession);
  });

  it("degrades to the bare id when the daemon is down (no port recorded)", async () => {
    process.env.LOCALTERM_SESSION_ID = SESSION_ID;
    vi.spyOn(state, "readPort").mockReturnValue(null);
    await runSessionCurrent({ json: false });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining(SESSION_ID));
    expect(process.exitCode).toBeUndefined();
  });

  it("reports not-a-live-session and exits 1 when the id is unknown to the daemon", async () => {
    process.env.LOCALTERM_SESSION_ID = SESSION_ID;
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "not_found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await runSessionCurrent({ json: false });
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("not a live session"));
    expect(process.exitCode).toBe(1);
  });
});
