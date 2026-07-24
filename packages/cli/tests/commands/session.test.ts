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

const { runSessionAttach, runSessionCapture, runSessionCurrent } = await import(
  "../../src/commands/session.js"
);

const SESSION_ID = "413bc0c9-5eec-4857-9dc8-7d38e19936a9";
const SHORT_ID = SESSION_ID.slice(0, 8);
const SECOND_SESSION_ID = "413bc0c9-1111-4111-8111-111111111111";

const stubSessionList = (sessionIds: string[]): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ sessions: sessionIds.map((sessionId) => ({ id: sessionId })) }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("runSessionAttach", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
    openMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("resolves a short id and opens at the daemon-local portless surface", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    stubSessionList([SESSION_ID]);
    await runSessionAttach(SHORT_ID);
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

  it("rejects an ambiguous short id without opening a tab", async () => {
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
    stubSessionList([SESSION_ID, SECOND_SESSION_ID]);
    await runSessionAttach(SHORT_ID);
    expect(openMock).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining("ambiguous"));
    expect(process.exitCode).toBe(1);
  });
});

describe("runSessionCapture", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
    vi.spyOn(state, "readPort").mockReturnValue(3417);
    vi.spyOn(state, "readHost").mockReturnValue("127.0.0.1");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses the full id when capturing from the short id printed by session ls", async () => {
    const requestUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requestUrls.push(requestUrl);
        if (requestUrl.endsWith("/api/sessions")) {
          return new Response(JSON.stringify({ sessions: [{ id: SESSION_ID }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (requestUrl.endsWith(`/api/sessions/${SESSION_ID}/pane`)) {
          return new Response(JSON.stringify({ text: "captured pane" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      }),
    );

    await runSessionCapture(SHORT_ID, { json: true });

    expect(requestUrls).toEqual([
      "http://127.0.0.1:3417/api/sessions",
      `http://127.0.0.1:3417/api/sessions/${SESSION_ID}/pane`,
    ]);
    expect(JSON.parse(consoleLogSpy.mock.calls[0][0] as string)).toEqual({
      text: "captured pane",
    });
  });

  it("reports an unknown prefix without requesting a pane", async () => {
    const fetchMock = stubSessionList([]);

    await runSessionCapture("deadbeef", { json: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("no live session matches deadbeef"),
    );
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
