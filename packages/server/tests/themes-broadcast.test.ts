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

const makeStateDir = (): string => path.join(os.tmpdir(), `localterm-themes-ws-${randomUUID()}`);

describe("createServer theme broadcast", { tags: ["integration"] }, () => {
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

  it('pushes {type:"themes"} to connected tabs on PUT /themes/active', async () => {
    const tab = await connect(server.port);
    try {
      const response = await fetch(api("/api/themes/active"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "dracula" }),
      });
      expect(response.ok).toBe(true);
      const message = (await tab.waitFor((value) => hasType(value, "themes"))) as {
        activeThemeId: string;
        customThemes: unknown[];
        initialized: boolean;
      };
      expect(message.activeThemeId).toBe("dracula");
      expect(message.customThemes).toEqual([]);
      expect(message.initialized).toBe(true);
    } finally {
      await closeWs(tab.socket);
    }
  });

  it("pushes an imported custom theme to every connected tab", async () => {
    const tabA = await connect(server.port);
    const tabB = await connect(server.port);
    try {
      const response = await fetch(api("/api/themes/import"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: JSON.stringify({ name: "Mine", colors: { background: "#0a0a0a" } }),
          filename: "mine.json",
        }),
      });
      expect(response.status).toBe(201);
      const created = (await response.json()) as { theme: { id: string } };

      const predicate = (value: unknown): boolean =>
        hasType(value, "themes") &&
        Array.isArray((value as { customThemes?: unknown[] }).customThemes) &&
        (value as { customThemes: { id: string }[] }).customThemes.some(
          (theme) => theme.id === created.theme.id,
        );
      const [a, b] = await Promise.all([tabA.waitFor(predicate), tabB.waitFor(predicate)]);
      // Import adds the custom theme without changing the active id (the browser
      // selects it with a separate PUT /themes/active); the broadcast carries the
      // new custom in customThemes and the unchanged active.
      const ids = (message: unknown) =>
        ((message as { customThemes: { id: string }[] }).customThemes ?? []).map(
          (theme) => theme.id,
        );
      expect(ids(a)).toEqual([created.theme.id]);
      expect(ids(b)).toEqual([created.theme.id]);
      expect((a as { activeThemeId: string }).activeThemeId).toBe("vesper");
      expect((b as { activeThemeId: string }).activeThemeId).toBe("vesper");
    } finally {
      await closeWs(tabA.socket);
      await closeWs(tabB.socket);
    }
  });

  it("pushes the reset-to-default active id when the active custom theme is deleted", async () => {
    const tab = await connect(server.port);
    try {
      const created = (
        await (
          await fetch(api("/api/themes/import"), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              text: JSON.stringify({ name: "Mine", colors: { background: "#0a0a0a" } }),
              filename: "mine.json",
            }),
          })
        ).json()
      ).theme as { id: string };
      await fetch(api("/api/themes/active"), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: created.id }),
      });
      await tab.waitFor(
        (value) =>
          hasType(value, "themes") &&
          (value as { activeThemeId: string }).activeThemeId === created.id,
      );

      await fetch(api(`/api/themes/${encodeURIComponent(created.id)}`), { method: "DELETE" });
      const after = (await tab.waitFor(
        (value) =>
          hasType(value, "themes") &&
          (value as { activeThemeId: string }).activeThemeId !== created.id,
      )) as { activeThemeId: string; customThemes: unknown[] };
      expect(after.activeThemeId).toBe("vesper");
      expect(after.customThemes).toEqual([]);
    } finally {
      await closeWs(tab.socket);
    }
  });
});
