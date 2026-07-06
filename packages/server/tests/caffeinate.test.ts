import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import {
  CaffeinateController,
  type CaffeinateProcessHandle,
} from "../src/caffeinate-controller.js";
import { CAFFEINATE_AUTO_DEFAULT_COMMANDS } from "../src/constants.js";
import { createServer, type RunningServer } from "../src/index.js";

type MessagePredicate = (message: unknown) => boolean;

// The expected broadcast shape, with sensible defaults overridable per assertion.
const caffeinateState = (overrides: Record<string, unknown> = {}) => ({
  type: "caffeinate",
  supported: true,
  active: false,
  mode: "automatic",
  activityGate: true,
  peerKeepAwake: true,
  peerActive: false,
  batteryThreshold: 20,
  defaultCommands: [...CAFFEINATE_AUTO_DEFAULT_COMMANDS],
  commands: [],
  activeTrigger: null,
  ...overrides,
});

const hasType = (message: unknown, type: string): message is Record<string, unknown> =>
  Boolean(
    message && typeof message === "object" && (message as Record<string, unknown>).type === type,
  );

const isCaffeinateState = (active: boolean): MessagePredicate => {
  return (message) => hasType(message, "caffeinate") && message.active === active;
};

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
    // A read cursor so each waitFor consumes frames in order: a later wait for
    // `active:false` won't match the initial connect frame an earlier wait
    // already passed. (This handler is registered after the buffering one, so
    // `messages` already includes the new frame when it runs.)
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

// A fake keep-awake process so the test never holds a real power assertion.
const createFakeSpawn = () => {
  const spawned: { killed: boolean }[] = [];
  const spawnProcess = (): CaffeinateProcessHandle => {
    const fake = { killed: false };
    spawned.push(fake);
    return {
      kill: () => {
        fake.killed = true;
      },
      onExit: () => {},
    };
  };
  return { spawned, spawnProcess };
};

const makeStateDir = (): string => path.join(os.tmpdir(), `localterm-caffeinate-${randomUUID()}`);

describe("createServer caffeinate broadcast", { tags: ["integration"] }, () => {
  let server: RunningServer;
  let spawned: { killed: boolean }[];
  let stateDirectory: string;

  beforeEach(async () => {
    const fakeSpawn = createFakeSpawn();
    spawned = fakeSpawn.spawned;
    stateDirectory = makeStateDir();
    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
      caffeinateController: new CaffeinateController({
        supported: true,
        spawnProcess: fakeSpawn.spawnProcess,
      }),
      // No matching processes, so automatic mode never activates and no real
      // `ps` is ever run.
      caffeinateSnapshotProcesses: async () => [],
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("sends the current keep-awake state on connect", async () => {
    const tab = await connect(server.port);
    try {
      const state = await tab.waitFor((message) => hasType(message, "caffeinate"));
      // Fresh state dir → default automatic mode, no custom commands, idle.
      expect(state).toEqual(caffeinateState());
      expect(spawned).toHaveLength(0);
    } finally {
      await closeWs(tab.socket);
    }
  });

  it("broadcasts a mode change to every connected tab", async () => {
    const tabA = await connect(server.port);
    const tabB = await connect(server.port);
    try {
      await tabA.waitFor((message) => hasType(message, "caffeinate"));
      await tabB.waitFor((message) => hasType(message, "caffeinate"));

      tabA.socket.send(JSON.stringify({ type: "caffeinate-mode", mode: "on" }));

      const [stateA, stateB] = await Promise.all([
        tabA.waitFor(isCaffeinateState(true)),
        tabB.waitFor(isCaffeinateState(true)),
      ]);
      expect(stateA).toEqual(caffeinateState({ mode: "on", active: true }));
      expect(stateB).toEqual(caffeinateState({ mode: "on", active: true }));
      expect(spawned).toHaveLength(1);

      tabB.socket.send(JSON.stringify({ type: "caffeinate-mode", mode: "off" }));
      await Promise.all([
        tabA.waitFor(isCaffeinateState(false)),
        tabB.waitFor(isCaffeinateState(false)),
      ]);
      expect(spawned[0].killed).toBe(true);
    } finally {
      await closeWs(tabA.socket);
      await closeWs(tabB.socket);
    }
  });

  it("broadcasts and persists custom trigger commands", async () => {
    const tab = await connect(server.port);
    try {
      await tab.waitFor((message) => hasType(message, "caffeinate"));
      tab.socket.send(
        JSON.stringify({ type: "caffeinate-commands", commands: ["  ollama  ", "ollama"] }),
      );
      const state = await tab.waitFor(
        (message) =>
          hasType(message, "caffeinate") &&
          Array.isArray(message.commands) &&
          message.commands.length === 1,
      );
      // Trimmed and de-duplicated by the store.
      expect(state).toEqual(caffeinateState({ commands: ["ollama"] }));
      const persisted = JSON.parse(
        fs.readFileSync(path.join(stateDirectory, "caffeinate.json"), "utf8"),
      );
      expect(persisted.commands).toEqual(["ollama"]);
    } finally {
      await closeWs(tab.socket);
    }
  });

  it("broadcasts and persists the peer keep-awake toggle", async () => {
    const tab = await connect(server.port);
    try {
      await tab.waitFor((message) => hasType(message, "caffeinate"));
      tab.socket.send(JSON.stringify({ type: "caffeinate-peer-keep-awake", enabled: false }));
      const state = await tab.waitFor(
        (message) => hasType(message, "caffeinate") && message.peerKeepAwake === false,
      );
      expect(state).toEqual(caffeinateState({ peerKeepAwake: false }));
      const persisted = JSON.parse(
        fs.readFileSync(path.join(stateDirectory, "caffeinate.json"), "utf8"),
      );
      expect(persisted.peerKeepAwake).toBe(false);
      expect(persisted.version).toBe(4);
    } finally {
      await closeWs(tab.socket);
    }
  });
});

describe("createServer caffeinate when unsupported", { tags: ["integration"] }, () => {
  it("reports unsupported and never spawns", async () => {
    const fakeSpawn = createFakeSpawn();
    const stateDirectory = makeStateDir();
    const server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
      caffeinateController: new CaffeinateController({
        supported: false,
        spawnProcess: fakeSpawn.spawnProcess,
      }),
      caffeinateSnapshotProcesses: async () => [],
    });
    const tab = await connect(server.port);
    try {
      const state = await tab.waitFor((message) => hasType(message, "caffeinate"));
      expect(state).toEqual(caffeinateState({ supported: false }));

      tab.socket.send(JSON.stringify({ type: "caffeinate-mode", mode: "on" }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(fakeSpawn.spawned).toHaveLength(0);
    } finally {
      await closeWs(tab.socket);
      await server.stop();
      fs.rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
});
