import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createServer, type RunningServer } from "../src/index.js";
import { WebSocket } from "ws";

const connectAndCollect = (
  port: number,
  timeoutMs = 10_000,
): Promise<{ socket: WebSocket; waitForSession: () => Promise<unknown> }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
    const messages: unknown[] = [];
    const sessionResolved: (() => void)[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.addEventListener("message", (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        parsed = event.data;
      }
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        parsed = event.data;
      }
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
    server = await createServer({ port: 0, host: "127.0.0.1" });
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

  it("echoes input back as output", async () => {
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
  });

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
