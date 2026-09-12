import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionLifecyclePolicy } from "../src/session-lifecycle-policy.js";
import { MAX_CONCURRENT_SESSIONS, SESSION_ACTIVITY_WINDOW_MS } from "../src/constants.js";
import type { ManagedSession } from "../src/session-manager.js";

describe("session capacity eviction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(SESSION_ACTIVITY_WINDOW_MS * 2);
  });
  afterEach(() => vi.useRealTimers());
  const setup = () => {
    const sessions = new Map<string, ManagedSession>();
    for (let index = 0; index < MAX_CONCURRENT_SESSIONS; index += 1) {
      const managed = {
        id: String(index),
        clients: new Set([{}]),
        pinned: false,
        hasForeground: false,
        lastOutputAt: 0,
        parkedAt: index,
        createdAt: index,
      } as ManagedSession;
      sessions.set(managed.id, managed);
    }
    const tearDown = vi.fn((managed: ManagedSession) => {
      sessions.delete(managed.id);
    });
    const policy = new SessionLifecyclePolicy(() => null, tearDown, vi.fn());
    const first = sessions.get("0");
    const second = sessions.get("1");
    if (!first || !second) throw new Error("missing fixture sessions");
    return { sessions, tearDown, policy, first, second };
  };

  it.each(["foreground", "recent-output", "pinned"])(
    "does not evict a detached %s session",
    (kind) => {
      const { sessions, policy, tearDown, first } = setup();
      first.clients.clear();
      if (kind === "foreground") first.hasForeground = true;
      else if (kind === "recent-output") first.lastOutputAt = Date.now();
      else first.pinned = true;
      expect(policy.atCapacity(sessions)).toBe(true);
      expect(policy.makeRoomForSession(sessions)).toBe(false);
      expect(tearDown).not.toHaveBeenCalled();
    },
  );

  it("evicts an idle session instead of an older busy detached one", () => {
    const { sessions, policy, tearDown, first, second } = setup();
    first.clients.clear();
    first.hasForeground = true;
    second.clients.clear();
    expect(policy.atCapacity(sessions)).toBe(false);
    expect(policy.makeRoomForSession(sessions)).toBe(true);
    expect(tearDown).toHaveBeenCalledExactlyOnceWith(second);
  });
});
