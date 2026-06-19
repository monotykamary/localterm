import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
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

  it("unregisters session on WS close", async () => {
    const { socket } = await connectAndCollect(server.port);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.registry.size()).toBe(1);
    await closeWs(socket);
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
    expect(body).toEqual({ ok: true, sessions: expect.any(Number) });
  });

  it("cleans up all sessions on stop", async () => {
    const { socket } = await connectAndCollect(server.port);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(server.registry.size()).toBe(1);
    await server.stop();
    expect(server.registry.size()).toBe(0);
    await closeWs(socket);
  });
});
