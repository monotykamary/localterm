import { afterEach, describe, expect, it } from "vite-plus/test";
import os from "node:os";
import { SessionManager, type ExecResult } from "../src/session-manager.js";

const createManager = (graceMs: number): SessionManager =>
  new SessionManager({
    getGraceMs: () => graceMs,
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

describe("SessionManager exec + programmatic PTY control", { tags: ["integration"] }, () => {
  let manager: SessionManager;

  afterEach(() => {
    manager?.disposeAll();
  });

  it("spawnDetached creates a pinned session surfaced in list()", () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    expect(id).not.toBeNull();
    const session = manager.list()[0];
    expect(session?.pinned).toBe(true);
    expect(session?.clients).toBe(0);
  });

  it("execInSession runs a command, captures output, and returns the exit code", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    const result = (await manager.execInSession(id, "echo hello-world", {
      timeoutMs: 5_000,
    })) as ExecResult | null;
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("hello-world");
    expect(result.timedOut).toBe(false);
  }, 10_000);

  it("execInSession captures a non-zero exit code", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    const result = await manager.execInSession(id, "false", { timeoutMs: 5_000 });
    expect(result?.exitCode).toBe(1);
  }, 10_000);

  it("in-session exec preserves cwd across calls", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    const first = await manager.execInSession(id, "cd /tmp && pwd", { timeoutMs: 5_000 });
    expect(first?.exitCode).toBe(0);
    const second = await manager.execInSession(id, "pwd", { timeoutMs: 5_000 });
    expect(second?.output).toContain("/tmp");
  }, 10_000);

  it("capturePane returns rendered screen text", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    await manager.execInSession(id, "echo capture-me", { timeoutMs: 5_000 });
    const text = await manager.capturePane(id);
    expect(text).not.toBeNull();
    expect(text).toContain("capture-me");
  }, 10_000);

  it("writeInputById / resizeById / setTitleById / setPinned operate by id", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    expect(manager.writeInputById(id, "echo typed\n")).toBe(true);
    expect(manager.resizeById(id, 100, 40)).toBe(true);
    expect(manager.setTitleById(id, "renamed")).toBe(true);
    expect(manager.list()[0]?.title).toBe("renamed");
    expect(manager.setPinned(id, false)).toBe(true);
    expect(manager.list()[0]?.pinned).toBe(false);
    // Unknown id → false (not a throw).
    expect(manager.writeInputById("00000000-0000-0000-0000-000000000000", "x")).toBe(false);
    expect(await manager.capturePane("00000000-0000-0000-0000-000000000000")).toBeNull();
    await wait(50);
  }, 10_000);

  it("a pinned dormant session is not reaped by the idle grace, but an unpinned one is", async () => {
    manager = createManager(50);
    const pinnedId = manager.spawnDetached(shellInput, true);
    const unpinnedId = manager.spawnDetached(shellInput, false);
    expect(pinnedId).not.toBeNull();
    expect(unpinnedId).not.toBeNull();
    // Force both idle so the reap is eligible for the unpinned one.
    if (pinnedId) manager.markIdleForTest(pinnedId);
    if (unpinnedId) manager.markIdleForTest(unpinnedId);
    await wait(150);
    expect(manager.size()).toBe(1);
    expect(manager.list()[0]?.id).toBe(pinnedId);
  }, 10_000);

  it("execInSession times out and reports partial output for a hung command", async () => {
    manager = createManager(30_000);
    const id = manager.spawnDetached(shellInput, true);
    if (!id) throw new Error("spawn failed");
    // A 1000ms timeout is generous enough to fire reliably under concurrent
    // suite load (a 200ms timeout raced the event loop + occasionally resolved
    // as a normal completion); sleep 30 can't finish before it, so the call
    // resolves as timed out.
    const result = await manager.execInSession(id, "sleep 30", { timeoutMs: 1000 });
    expect(result?.timedOut).toBe(true);
    expect(result?.exitCode).toBeNull();
  }, 10_000);
});
