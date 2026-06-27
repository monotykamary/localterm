import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, healthSchema, type RunningServer } from "../src/index.js";
import { WebSocket } from "ws";

// Output frames arrive as binary (raw UTF-8 bytes) so the client can dispense
// with JSON.parse. In tests we normalize them back into a JSON-shaped
// {type:"output", data:string} so assertions that write
// `message.type === "output"` (or match a string data field) remain unchanged.
const normalizeMessage = (event: WebSocket.MessageEvent): unknown => {
  if (event.data instanceof ArrayBuffer) {
    return { type: "output", data: Buffer.from(event.data).toString("utf8") };
  }
  try {
    return JSON.parse(event.data as string);
  } catch {
    return event.data;
  }
};

const connectAndCollect = (
  port: number,
  timeoutMs = 10_000,
): Promise<{ socket: WebSocket; waitForSession: () => Promise<unknown> }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
    const messages: unknown[] = [];
    const sessionResolved: (() => void)[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", (event) => {
      const parsed = normalizeMessage(event);
      messages.push(parsed);
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).type === "session"
      ) {
        for (const resolver of sessionResolved) resolver();
        sessionResolved.length = 0;
      }
    });
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        socket,
        waitForSession: () =>
          messages.some(
            (message) =>
              message &&
              typeof message === "object" &&
              (message as Record<string, unknown>).type === "session",
          )
            ? Promise.resolve(
                messages.find(
                  (message) =>
                    message &&
                    typeof message === "object" &&
                    (message as Record<string, unknown>).type === "session",
                ),
              )
            : new Promise<void>((resolve) => sessionResolved.push(resolve)).then(() =>
                messages.find(
                  (message) =>
                    message &&
                    typeof message === "object" &&
                    (message as Record<string, unknown>).type === "session",
                ),
              ),
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    });
  });

const waitForMessage = (
  socket: WebSocket,
  predicate: (message: unknown) => boolean,
  timeoutMs = 10_000,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for matching message")),
      timeoutMs,
    );
    const handler = (event: WebSocket.MessageEvent) => {
      const parsed = normalizeMessage(event);
      if (predicate(parsed)) {
        clearTimeout(timer);
        socket.removeEventListener("message", handler);
        resolve(parsed);
      }
    };
    socket.addEventListener("message", handler);
  });

const closeWs = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.addEventListener("close", () => resolve());
    socket.close();
  });

describe("createServer WS lifecycle", () => {
  let server: RunningServer;

  beforeEach(async () => {
    // Inject a no-op tab controller so the server doesn't reach for a real CDP browser.
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("sends a session frame on connect", async () => {
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      const session = await waitForSession();
      expect(session).toEqual(
        expect.objectContaining({
          type: "session",
          shell: expect.any(String),
          pid: expect.any(Number),
        }),
      );
    } finally {
      await closeWs(socket);
    }
  });

  it("tracks sessions in the registry", async () => {
    expect(server.registry.size()).toBe(0);
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      await waitForSession();
      expect(server.registry.size()).toBe(1);
    } finally {
      await closeWs(socket);
    }
  });

  it("keeps the PTY alive (dormant) on WS close", async () => {
    const { socket } = await connectAndCollect(server.port);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.registry.size()).toBe(1);
    await closeWs(socket);
    await new Promise((resolve) => setTimeout(resolve, 200));
    // Closing the tab detaches; the shell parks (dormant) for the grace
    // window so another tab can re-attach to it from the session picker.
    expect(server.registry.size()).toBe(1);
    const list = (await (await fetch(`http://127.0.0.1:${server.port}/api/sessions`)).json()) as {
      sessions: { id: string }[];
    };
    expect(list.sessions).toHaveLength(1);
    const killResponse = await fetch(
      `http://127.0.0.1:${server.port}/api/sessions/${list.sessions[0].id}`,
      { method: "DELETE" },
    );
    expect(killResponse.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.registry.size()).toBe(0);
  });

  it("echoes input back as binary output", async () => {
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      await waitForSession();
      socket.send(JSON.stringify({ type: "input", data: "echo hi\n" }));
      const output = await waitForMessage(socket, (message) =>
        Boolean(
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).type === "output",
        ),
      );
      expect(output).toEqual(
        expect.objectContaining({
          type: "output",
          data: expect.any(String),
        }),
      );
    } finally {
      await closeWs(socket);
    }
  });

  // The sibling "echoes input back as binary output" test decodes binary frames
  // back to {type:"output"} via normalizeMessage, so a regression making the
  // server emit JSON {type:"output"} text would still pass it. This side-listens
  // for the raw event before sending input and asserts the first output frame's
  // event.data is an ArrayBuffer (binary), never a JSON string. Guards against
  // re-adding the JSON output path that 2.7.4 inadvertently shipped without the
  // client-side instanceof branch being covered.
  it("emits output as a raw binary ArrayBuffer frame, not JSON text", async () => {
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      await waitForSession();

      let rawOutputFrame: unknown = null;
      const captureRawOutput = (event: WebSocket.MessageEvent) => {
        if (rawOutputFrame === null && event.data instanceof ArrayBuffer) {
          rawOutputFrame = event.data;
        }
      };
      socket.addEventListener("message", captureRawOutput);

      socket.send(JSON.stringify({ type: "input", data: "echo hi\n" }));
      await waitForMessage(socket, (message) =>
        Boolean(
          message &&
          typeof message === "object" &&
          (message as Record<string, unknown>).type === "output",
        ),
      );
      socket.removeEventListener("message", captureRawOutput);

      expect(rawOutputFrame).toBeInstanceOf(ArrayBuffer);
      expect(Buffer.from(rawOutputFrame as ArrayBuffer).toString("utf8")).toContain("hi");
    } finally {
      await closeWs(socket);
    }
  });

  it("rejects invalid JSON gracefully", async () => {
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      await waitForSession();
      socket.send("not json");
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(socket.readyState).toBe(WebSocket.OPEN);
    } finally {
      await closeWs(socket);
    }
  });

  it("closes with capacity limit when max sessions exceeded", async () => {
    const sockets: WebSocket[] = [];
    try {
      for (let index = 0; index < 64; index++) {
        const { socket } = await connectAndCollect(server.port);
        sockets.push(socket);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rejected = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      const closeEvent = await new Promise<WebSocket.CloseEvent>((resolve) => {
        rejected.addEventListener("close", (event) => resolve(event));
      });
      expect(closeEvent.code).toBe(4503);
    } finally {
      for (const socket of sockets) await closeWs(socket);
    }
  }, 10_000);

  it("responds to health check", async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(response.ok).toBe(true);
    const body = await response.json();
    expect(body).toEqual({ ok: true, sessions: expect.any(Number), cdp: null });
  });

  it("reports the live CDP state as disabled when a tab controller is injected", async () => {
    // The beforeEach server injects a tabController, so the daemon owns no
    // CdpClient and the health field is null (the CDP path is off).
    const response = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    const parsed = healthSchema.parse(await response.json());
    expect(parsed.cdp).toBeNull();
  });

  it("reports CDP as not connected when no debug-enabled browser is reachable", async () => {
    const cdpLess = await createServer({
      port: 0,
      host: "127.0.0.1",
      cdpDetect: async () => [],
    });
    try {
      // Give the fire-and-forget connect() a beat to settle into its failed
      // state (no candidates → establish() rejects → isConnected() stays false).
      await new Promise((resolve) => setTimeout(resolve, 50));
      const parsed = healthSchema.parse(
        await (await fetch(`http://127.0.0.1:${cdpLess.port}/api/health`)).json(),
      );
      expect(parsed.cdp).toEqual({ connected: false });
    } finally {
      await cdpLess.stop();
    }
  });

  it("cleans up all sessions on stop", async () => {
    const { socket } = await connectAndCollect(server.port);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.registry.size()).toBe(1);
    await server.stop();
    expect(server.registry.size()).toBe(0);
    await closeWs(socket);
  });

  it("attaches a session id to the session frame for reattach", async () => {
    const { socket, waitForSession } = await connectAndCollect(server.port);
    try {
      const session = (await waitForSession()) as { id?: string; pid: number };
      expect(typeof session.id).toBe("string");
      expect(session.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    } finally {
      await closeWs(socket);
    }
  });

  it("parks the PTY on WS close and reattaches it on ?sid= reconnect", async () => {
    const connectAndCollectSid = async (
      port: number,
      sid: string | null,
    ): Promise<{
      socket: WebSocket;
      session: { id?: string; pid: number };
    }> => {
      const url = sid
        ? `ws://127.0.0.1:${port}/ws?sid=${encodeURIComponent(sid)}`
        : `ws://127.0.0.1:${port}/ws`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        socket.addEventListener("message", function listener(event) {
          const parsed = normalizeMessage(event as WebSocket.MessageEvent);
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed as Record<string, unknown>).type === "session"
          ) {
            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve({ socket, session: parsed as { id?: string; pid: number } });
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        });
      });
    };

    const first = await connectAndCollectSid(server.port, null);
    const firstPid = first.session.pid;
    const sid = first.session.id!;
    expect(typeof sid).toBe("string");
    expect(server.registry.size()).toBe(1);

    // Drop the WS. The PTY detaches and stays alive (dormant) behind `sid` —
    // see SessionManager.
    await closeWs(first.socket);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(server.registry.size()).toBe(1);

    // Reconnect with the matching sid: the daemon re-attaches the parked PTY
    // instead of spawning a fresh shell, so the pid matches and the same id
    // is returned.
    const reattached = await connectAndCollectSid(server.port, sid);
    try {
      expect(reattached.session.pid).toBe(firstPid);
      expect(reattached.session.id).toBe(sid);
      expect(server.registry.size()).toBe(1);
    } finally {
      await closeWs(reattached.socket);
    }
  });

  it("spawns a fresh PTY when ?sid= misses the pool (grace expired or unknown)", async () => {
    const connectAndCollectSid = async (
      port: number,
      sid: string | null,
    ): Promise<{
      socket: WebSocket;
      session: { id?: string; pid: number };
    }> => {
      const url = sid
        ? `ws://127.0.0.1:${port}/ws?sid=${encodeURIComponent(sid)}`
        : `ws://127.0.0.1:${port}/ws`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        socket.addEventListener("message", function listener(event) {
          const parsed = normalizeMessage(event as WebSocket.MessageEvent);
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed as Record<string, unknown>).type === "session"
          ) {
            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve({ socket, session: parsed as { id?: string; pid: number } });
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        });
      });
    };

    // An unknown sid must fall through to a fresh spawn, not close the socket.
    const result = await connectAndCollectSid(server.port, "00000000-0000-0000-0000-000000000000");
    try {
      expect(typeof result.session.id).toBe("string");
      expect(result.session.id).not.toBe("00000000-0000-0000-0000-000000000000");
      expect(server.registry.size()).toBe(1);
    } finally {
      await closeWs(result.socket);
    }
  });

  it("fans output out to every client attached to the same PTY", async () => {
    const connectWithSid = async (
      sid: string | null,
    ): Promise<{ socket: WebSocket; session: { id?: string; pid: number } }> => {
      const url = sid
        ? `ws://127.0.0.1:${server.port}/ws?sid=${encodeURIComponent(sid)}`
        : `ws://127.0.0.1:${server.port}/ws`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
        const socket = new WebSocket(url);
        socket.binaryType = "arraybuffer";
        socket.addEventListener("message", function listener(event) {
          const parsed = normalizeMessage(event as WebSocket.MessageEvent);
          if (
            parsed &&
            typeof parsed === "object" &&
            (parsed as Record<string, unknown>).type === "session"
          ) {
            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve({ socket, session: parsed as { id?: string; pid: number } });
          }
        });
        socket.addEventListener("error", () => {
          clearTimeout(timer);
          reject(new Error("ws error"));
        });
      });
    };

    const first = await connectWithSid(null);
    const sid = first.session.id!;
    first.socket.send(JSON.stringify({ type: "ready", replay: false }));

    // A second tab attaches to the same live PTY by id.
    const second = await connectWithSid(sid);
    expect(second.session.id).toBe(sid);
    expect(second.session.pid).toBe(first.session.pid);
    second.socket.send(JSON.stringify({ type: "ready", replay: false }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    first.socket.send(JSON.stringify({ type: "input", data: "echo FANOUT_MARKER_42\n" }));
    const matchesMarker = (message: unknown): boolean =>
      Boolean(
        message &&
        typeof message === "object" &&
        (message as Record<string, unknown>).type === "output" &&
        String((message as { data?: string }).data).includes("FANOUT_MARKER_42"),
      );
    await Promise.all([
      waitForMessage(first.socket, matchesMarker),
      waitForMessage(second.socket, matchesMarker),
    ]);

    await closeWs(first.socket);
    await closeWs(second.socket);
  });
});
