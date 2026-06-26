import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import { SessionManager } from "../src/session-manager.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";

const createFakeSocket = (): ClientSocket => ({
  readyState: 1,
  send: () => {},
  close: () => {},
});

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    graceMs,
    sendControl: () => {},
    hooks: {
      onOutputActivity: () => {},
      onSessionActivity: () => {},
      onSessionEvent: () => {},
      onAutomationExit: () => {},
      onClientExit: () => {},
    },
  });

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const shellInput = { shell: "/bin/sh", cwd: os.tmpdir() };

describe("SessionManager no-clients grace", () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("reaps a PTY whose last subscriber detaches and doesn't re-attach in time", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(1);

    manager.detach(ws);
    // Detached → grace armed, but the PTY is still live (parked) for the window.
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.clients).toBe(0);

    await wait(150);
    // Grace elapsed with no re-attach → reaped. No zombie.
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("cancels the grace when a subscriber re-attaches within the window", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    const sid = spawned.id;

    manager.detach(ws);
    expect(manager.size()).toBe(1);

    // A second tab joins alongside before the grace fires.
    const joining = createFakeSocket();
    const reattached = manager.attach(joining, sid);
    expect(reattached).not.toBeNull();
    expect(manager.list()[0]?.clients).toBe(1);

    await wait(150);
    // The re-attach cancelled the grace, so the PTY survived the window.
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Now the joining tab leaves too; a fresh grace starts and reaps it.
    manager.detach(joining);
    await wait(150);
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("returns null when attaching to an unknown id (caller spawns fresh)", () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    expect(manager.attach(ws, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
