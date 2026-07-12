import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { createServer, type RunningServer } from "../src/index.js";

type MessagePredicate = (message: unknown) => boolean;

const hasType = (message: unknown, type: string): boolean =>
  typeof message === "object" &&
  message !== null &&
  (message as Record<string, unknown>).type === type;

interface CollectedSocket {
  socket: WebSocket;
  waitFor: (predicate: MessagePredicate, timeoutMs?: number) => Promise<unknown>;
}

const connect = (port: number, timeoutMs = 10_000): Promise<CollectedSocket> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), timeoutMs);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: unknown[] = [];
    socket.addEventListener("message", (event) => {
      try {
        messages.push(JSON.parse(event.data as string));
      } catch {
        /* ignore non-JSON frames */
      }
    });
    let cursor = 0;
    const consumeMatch = (predicate: MessagePredicate): unknown => {
      for (let index = cursor; index < messages.length; index += 1) {
        if (predicate(messages[index])) {
          cursor = index + 1;
          return messages[index];
        }
      }
      return undefined;
    };
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve({
        socket,
        waitFor: (predicate, waitTimeoutMs = 10_000) => {
          const existing = consumeMatch(predicate);
          if (existing !== undefined) return Promise.resolve(existing);
          return new Promise((settle, rejectWait) => {
            const waitTimer = setTimeout(() => {
              socket.removeEventListener("message", listener);
              rejectWait(new Error("timeout waiting for matching message"));
            }, waitTimeoutMs);
            const listener = () => {
              const matched = consumeMatch(predicate);
              if (matched === undefined) return;
              clearTimeout(waitTimer);
              socket.removeEventListener("message", listener);
              settle(matched);
            };
            socket.addEventListener("message", listener);
          });
        },
      });
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    });
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

const makeStateDir = (): string => path.join(os.tmpdir(), `localterm-fonts-ws-${randomUUID()}`);

describe("createServer font broadcast", { tags: ["integration"] }, () => {
  let server: RunningServer;
  let stateDirectory: string;

  beforeEach(async () => {
    stateDirectory = makeStateDir();
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  const api = (path: string) => `http://127.0.0.1:${server.port}${path}`;

  it('pushes {type:"fonts"} to connected tabs on PUT /fonts', async () => {
    const tab = await connect(server.port);
    try {
      const response = await fetch(api("/api/fonts"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeFontId: "jetbrains-mono" }),
      });
      expect(response.ok).toBe(true);
      const message = (await tab.waitFor((value) => hasType(value, "fonts"))) as {
        activeFontId: string;
        customFontFamily: string;
        nerdFontEnabled: boolean;
        ligaturesEnabled: boolean;
        initialized: boolean;
      };
      expect(message.activeFontId).toBe("jetbrains-mono");
      expect(message.customFontFamily).toBe("");
      expect(message.nerdFontEnabled).toBe(false);
      expect(message.ligaturesEnabled).toBe(false);
      expect(message.initialized).toBe(true);
    } finally {
      await closeWs(tab.socket);
    }
  });

  it("pushes a font toggle update to every connected tab", async () => {
    const tabA = await connect(server.port);
    const tabB = await connect(server.port);
    try {
      const response = await fetch(api("/api/fonts"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nerdFontEnabled: true, ligaturesEnabled: true }),
      });
      expect(response.ok).toBe(true);

      const predicate = (value: unknown): boolean =>
        hasType(value, "fonts") &&
        (value as { nerdFontEnabled?: boolean }).nerdFontEnabled === true;
      const [a, b] = await Promise.all([tabA.waitFor(predicate), tabB.waitFor(predicate)]);
      expect((a as { ligaturesEnabled: boolean }).ligaturesEnabled).toBe(true);
      expect((b as { ligaturesEnabled: boolean }).ligaturesEnabled).toBe(true);
    } finally {
      await closeWs(tabA.socket);
      await closeWs(tabB.socket);
    }
  });

  it("pushes the custom family + active custom id together", async () => {
    const tab = await connect(server.port);
    try {
      await fetch(api("/api/fonts"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ activeFontId: "custom", customFontFamily: "MesloLGS NF" }),
      });
      const message = (await tab.waitFor(
        (value) =>
          hasType(value, "fonts") && (value as { activeFontId?: string }).activeFontId === "custom",
      )) as { activeFontId: string; customFontFamily: string };
      expect(message.activeFontId).toBe("custom");
      expect(message.customFontFamily).toBe("MesloLGS NF");
    } finally {
      await closeWs(tab.socket);
    }
  });
});
