import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CaffeinateController,
  type CaffeinateProcessHandle,
} from "../src/caffeinate-controller.js";
import { CaffeinateManager } from "../src/caffeinate-manager.js";
import { CaffeinatePreferencesStore } from "../src/caffeinate-preferences-store.js";
import type { ProcessSnapshotEntry } from "../src/caffeinate-process-match.js";

const createFakeController = (supported = true) => {
  const spawned: { killed: boolean }[] = [];
  const controller = new CaffeinateController({
    supported,
    spawnProcess: (): CaffeinateProcessHandle => {
      const fake = { killed: false };
      spawned.push(fake);
      return { kill: () => (fake.killed = true), onExit: () => {} };
    },
  });
  return { controller, spawned };
};

const claudeUnderSession = (shellPid: number): ProcessSnapshotEntry[] => [
  { pid: shellPid, ppid: 1, command: "-zsh" },
  { pid: shellPid + 1, ppid: shellPid, command: "node /opt/homebrew/bin/claude" },
];

describe("CaffeinateManager", () => {
  let dir: string;
  let store: CaffeinatePreferencesStore;
  let sessionPids: number[];
  let snapshot: ProcessSnapshotEntry[];

  const build = (supported = true) => {
    const { controller, spawned } = createFakeController(supported);
    const manager = new CaffeinateManager({
      controller,
      store,
      listSessionPids: () => sessionPids,
      snapshotProcesses: async () => snapshot,
    });
    return { manager, controller, spawned };
  };

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `localterm-caffeinate-mgr-${randomUUID()}`);
    store = new CaffeinatePreferencesStore(path.join(dir, "caffeinate.json"));
    sessionPids = [];
    snapshot = [];
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stays inactive in automatic mode with no matching process", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("is always active in on mode and never in off mode", () => {
    const { manager, controller, spawned } = build();
    manager.setMode("on");
    expect(controller.active).toBe(true);
    expect(spawned).toHaveLength(1);
    manager.setMode("off");
    expect(controller.active).toBe(false);
    expect(spawned[0].killed).toBe(true);
    manager.dispose();
  });

  it("activates in automatic mode when a recognized program runs in a session", async () => {
    const { manager, controller } = build();
    expect(manager.mode).toBe("automatic");
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Program exits → caffeinate releases.
    snapshot = [{ pid: 100, ppid: 1, command: "-zsh" }];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("releases when the last triggering session goes away", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = claudeUnderSession(100);
    await manager.pollNow();
    expect(controller.active).toBe(true);

    // Session disconnects: its pid is gone even though the (now-orphaned) row
    // lingers in the snapshot. This is the re-check the disconnect event drives.
    sessionPids = [];
    await manager.pollNow();
    expect(controller.active).toBe(false);
    manager.dispose();
  });

  it("honors a user-added custom command", async () => {
    const { manager, controller } = build();
    sessionPids = [100];
    snapshot = [
      { pid: 100, ppid: 1, command: "-zsh" },
      { pid: 101, ppid: 100, command: "/usr/local/bin/ollama serve" },
    ];
    await manager.pollNow();
    expect(controller.active).toBe(false); // not a default trigger yet

    manager.setCommands(["ollama"]);
    await manager.pollNow();
    expect(controller.active).toBe(true);
    manager.dispose();
  });

  it("never activates when unsupported", async () => {
    const { manager, controller, spawned } = build(false);
    expect(manager.supported).toBe(false);
    manager.setMode("on");
    expect(controller.active).toBe(false);
    expect(spawned).toHaveLength(0);
    manager.dispose();
  });

  it("emits change on mode changes", () => {
    const { manager } = build();
    let changes = 0;
    manager.on("change", () => (changes += 1));
    manager.setMode("on");
    manager.setMode("off");
    expect(changes).toBeGreaterThanOrEqual(2);
    manager.dispose();
  });
});
