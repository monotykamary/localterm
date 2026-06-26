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

  it("reaps an idle PTY whose last subscriber detaches and doesn't re-attach in time", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A real /bin/sh keeps emitting its prompt, which would reschedule the
    // grace forever; force idle so the reap is eligible.
    manager.markIdleForTest(spawned.id);
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

    // Now the joining tab leaves too; a fresh grace starts. Mark idle so the
    // real shell's prompt output doesn't reschedule the reap.
    manager.detach(joining);
    manager.markIdleForTest(sid);
    await wait(150);
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant PTY alive while it's still producing output", async () => {
    manager = createManager(40);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);
    // The shell keeps producing — keep refreshing lastOutputAt within the
    // activity window across several grace intervals.
    for (let tick = 0; tick < 5; tick++) {
      await wait(20);
      manager.noteOutput(spawned.session.pid);
    }
    await wait(10);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);
    // Output goes quiet → the next grace fires and reaps.
    manager.markIdleForTest(spawned.id);
    await wait(120);
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("keeps a dormant PTY alive while a foreground program runs quietly (alive-quiet)", async () => {
    manager = createManager(50);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    manager.detach(ws);

    // Output has gone quiet but a foreground program is still running — the
    // favicon would be blue (alive-quiet), not grey. The grace reap must spare
    // it so a closed tab never kills a quiet-but-running command.
    manager.markIdleForTest(spawned.id);
    manager.markForegroundForTest(spawned.id);
    await wait(150);
    expect(manager.size()).toBe(1);
    expect(spawned.session.isExited).toBe(false);

    // Foreground program exits → only output idleness is left (ready) → reaped.
    manager.markForegroundForTest(spawned.id, false);
    await wait(150);
    expect(manager.size()).toBe(0);
    expect(spawned.session.isExited).toBe(true);
  }, 10_000);

  it("returns null when attaching to an unknown id (caller spawns fresh)", () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    expect(manager.attach(ws, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("reports the favicon-equivalent activity state on the session list", async () => {
    manager = createManager(60_000);
    const ws = createFakeSocket();
    const spawned = manager.spawnAndAttach(ws, shellInput);
    expect(spawned).not.toBeNull();
    if (!spawned) return;
    // A freshly-spawned shell just emitted its prompt — recent output → running.
    const states = manager.list().map((entry) => entry.state);
    expect(states).toContain("running");

    manager.markIdleForTest(spawned.id);
    // Idle with no foreground program → ready.
    expect(manager.list()[0]?.state).toBe("ready");
  }, 10_000);
});
