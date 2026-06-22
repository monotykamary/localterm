import { afterEach, describe, expect, it } from "vite-plus/test";
import { EventEmitter } from "node:events";
import {
  SessionReattachPool,
  generateSessionId,
  type ParkedSession,
} from "../src/session-reattach-pool.js";
import type { Session } from "../src/session.js";

const createStubSession = (pid: number): Session & { isExited: boolean } => {
  const emitter = new EventEmitter();
  const stub = Object.assign(emitter, {
    pid,
    isExited: false,
    disposed: false,
    dispose: () => {
      stub.disposed = true;
    },
  });
  return stub as unknown as Session & { isExited: boolean; disposed: boolean };
};

describe("SessionReattachPool", () => {
  let pool: SessionReattachPool;

  afterEach(() => {
    pool?.disposeAll();
  });

  it("parks a live Session behind a fresh sid and re-binds it on claim", () => {
    pool = new SessionReattachPool({ graceMs: 60_000 });
    const session = createStubSession(1001);
    const sid = generateSessionId();

    const parked = pool.park(session, {
      sid,
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    expect(parked.sid).toBe(sid);
    expect(pool.size()).toBe(1);
    expect(pool.has(sid)).toBe(true);

    const claimed = pool.claim(sid);
    expect(claimed).toBe(parked);
    expect(pool.size()).toBe(0);
    expect(pool.has(sid)).toBe(false);
    expect((session as unknown as { disposed: boolean }).disposed).toBe(false);
  });

  it("returns null when claiming an unknown sid (miss is safe)", () => {
    pool = new SessionReattachPool({ graceMs: 60_000 });
    expect(pool.claim("missing")).toBeNull();
  });

  it("collides on a duplicate sid rather than silently clobbering", () => {
    pool = new SessionReattachPool({ graceMs: 60_000 });
    const session = createStubSession(1002);
    const sid = generateSessionId();
    pool.park(session, {
      sid,
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    expect(() =>
      pool.park(createStubSession(1003), {
        sid,
        claimedRunId: null,
        claimedTargetId: null,
        automationId: null,
      }),
    ).toThrow(/already parked/);
  });

  it("disposes the PTY when the grace timer elapses without a reattach", async () => {
    pool = new SessionReattachPool({ graceMs: 10 });
    const session = createStubSession(1004);
    const sid = generateSessionId();
    pool.park(session, {
      sid,
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(pool.has(sid)).toBe(false);
    expect((session as unknown as { disposed: boolean }).disposed).toBe(true);
  });

  it("disposes the PTY promptly when the shell exits while parked", () => {
    let exitWhileParked: ParkedSession | null = null;
    pool = new SessionReattachPool({
      graceMs: 60_000,
      hooks: {
        onExitWhileParked: (p) => {
          exitWhileParked = p;
        },
      },
    });
    const session = createStubSession(1006);
    const sid = generateSessionId();
    const parked = pool.park(session, {
      sid,
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    session.emit("exit", 0);
    expect(pool.has(sid)).toBe(false);
    expect((session as unknown as { disposed: boolean }).disposed).toBe(true);
    expect(exitWhileParked).toBe(parked);
  });

  it("generateSessionId returns unique uuid-shaped ids", () => {
    const sid1 = generateSessionId();
    const sid2 = generateSessionId();
    expect(sid1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sid2).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(sid1).not.toBe(sid2);
  });

  it("disposeAll tears down every parked PTY and clears the pool", () => {
    pool = new SessionReattachPool({ graceMs: 60_000 });
    const session1 = createStubSession(1007);
    const session2 = createStubSession(1008);
    pool.park(session1, {
      sid: generateSessionId(),
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    pool.park(session2, {
      sid: generateSessionId(),
      claimedRunId: null,
      claimedTargetId: null,
      automationId: null,
    });
    expect(pool.size()).toBe(2);
    pool.disposeAll();
    expect(pool.size()).toBe(0);
    expect((session1 as unknown as { disposed: boolean }).disposed).toBe(true);
    expect((session2 as unknown as { disposed: boolean }).disposed).toBe(true);
  });
});
