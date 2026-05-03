import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SessionManager } from "./session-manager.js";

const REAL_FS_TIMEOUT_MS = 8000;

interface FakeTimer {
  id: number;
  fire: () => void;
  delayMs: number;
  cancelled: boolean;
}

const createFakeClock = () => {
  const timers = new Map<number, FakeTimer>();
  let nextId = 1;
  const setTimer = (handler: () => void, delayMs: number): unknown => {
    const id = nextId++;
    const timer: FakeTimer = {
      id,
      delayMs,
      cancelled: false,
      fire: () => {
        if (timer.cancelled) return;
        timers.delete(id);
        handler();
      },
    };
    timers.set(id, timer);
    return timer;
  };
  const clearTimer = (handle: unknown): void => {
    const timer = handle as FakeTimer | undefined;
    if (!timer) return;
    timer.cancelled = true;
    timers.delete(timer.id);
  };
  const flushPending = (): void => {
    const pending = [...timers.values()];
    for (const timer of pending) timer.fire();
  };
  return { setTimer, clearTimer, flushPending, pendingCount: () => timers.size };
};

let tempDir: string;
let canonicalTempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), "localterm-mgr-"));
  canonicalTempDir = realpathSync(tempDir);
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const waitForPrompt = (millis: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, millis));

describe("SessionManager", () => {
  it(
    "inherits cwd from a source session via lsof/readlink",
    async () => {
      const manager = new SessionManager();
      try {
        const source = await manager.create({ shell: "/bin/sh", cwd: tempDir });
        await waitForPrompt(400);
        source.write(`cd "${tempDir}"\n`);
        await waitForPrompt(400);

        const inheritor = await manager.create({
          shell: "/bin/sh",
          inheritCwdFromSessionId: source.id,
        });
        const meta = inheritor.metadata();
        expect(realpathSync(meta.cwd)).toBe(canonicalTempDir);
      } finally {
        manager.disposeAll();
      }
    },
    REAL_FS_TIMEOUT_MS,
  );

  it("falls back to default cwd when source session is unknown", async () => {
    const manager = new SessionManager();
    try {
      const created = await manager.create({
        shell: "/bin/sh",
        inheritCwdFromSessionId: "does-not-exist",
      });
      const meta = created.metadata();
      expect(meta.cwd).toBe(os.homedir());
    } finally {
      manager.disposeAll();
    }
  });

  it("explicit cwd wins over inheritance", async () => {
    const manager = new SessionManager();
    try {
      const source = await manager.create({ shell: "/bin/sh", cwd: tempDir });
      const created = await manager.create({
        shell: "/bin/sh",
        cwd: os.homedir(),
        inheritCwdFromSessionId: source.id,
      });
      expect(created.metadata().cwd).toBe(os.homedir());
    } finally {
      manager.disposeAll();
    }
  });

  it("never reaps a session that no client has ever attached to", async () => {
    const clock = createFakeClock();
    const manager = new SessionManager({
      idleReapMs: 1,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      const session = await manager.create({ shell: "/bin/sh" });
      clock.flushPending();
      expect(manager.get(session.id)).toBeDefined();
    } finally {
      manager.disposeAll();
    }
  });

  it("reaps an idle session once every client detaches and the grace timer fires", async () => {
    const clock = createFakeClock();
    const manager = new SessionManager({
      idleReapMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const reaped: string[] = [];
    manager.on("reaped", (id) => reaped.push(id));
    try {
      const session = await manager.create({ shell: "/bin/sh" });
      manager.attach(session.id);
      manager.detach(session.id);
      expect(manager.get(session.id)).toBeDefined();
      clock.flushPending();
      expect(manager.get(session.id)).toBeUndefined();
      expect(reaped).toEqual([session.id]);
    } finally {
      manager.disposeAll();
    }
  });

  it("cancels a pending reap when a fresh client reattaches before the grace expires", async () => {
    const clock = createFakeClock();
    const manager = new SessionManager({
      idleReapMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      const session = await manager.create({ shell: "/bin/sh" });
      manager.attach(session.id);
      manager.detach(session.id);
      expect(clock.pendingCount()).toBe(1);
      manager.attach(session.id);
      expect(clock.pendingCount()).toBe(0);
      clock.flushPending();
      expect(manager.get(session.id)).toBeDefined();
    } finally {
      manager.disposeAll();
    }
  });

  it("keeps a session alive while at least one client remains attached", async () => {
    const clock = createFakeClock();
    const manager = new SessionManager({
      idleReapMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    try {
      const session = await manager.create({ shell: "/bin/sh" });
      manager.attach(session.id);
      manager.attach(session.id);
      manager.detach(session.id);
      expect(clock.pendingCount()).toBe(0);
      clock.flushPending();
      expect(manager.get(session.id)).toBeDefined();
    } finally {
      manager.disposeAll();
    }
  });

  it("disposeAll cancels pending reap timers", async () => {
    const clock = createFakeClock();
    const manager = new SessionManager({
      idleReapMs: 30_000,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const session = await manager.create({ shell: "/bin/sh" });
    manager.attach(session.id);
    manager.detach(session.id);
    expect(clock.pendingCount()).toBe(1);
    manager.disposeAll();
    expect(clock.pendingCount()).toBe(0);
  });
});
