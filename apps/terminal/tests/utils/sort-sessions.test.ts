import { describe, expect, it } from "vite-plus/test";
import type { SessionListItem } from "@monotykamary/localterm-server/protocol";
import { sortSessions } from "../../src/utils/sort-sessions";

const buildSession = (overrides: Partial<SessionListItem> & { id: string }): SessionListItem => ({
  pid: 1,
  shell: "/bin/zsh",
  shellName: "zsh",
  cwd: "/tmp",
  title: "tmp",
  createdAt: 0,
  clients: 0,
  state: "ready",
  lastOutputAt: 0,
  pinned: false,
  ...overrides,
});

describe("sortSessions", () => {
  it("pins the current session to the top regardless of activity", () => {
    const current = buildSession({ id: "current", state: "ready", lastOutputAt: 100 });
    const running = buildSession({ id: "running", state: "running", lastOutputAt: 900 });
    const ordered = sortSessions([running, current], "current", "");
    expect(ordered.map((session) => session.id)).toEqual(["current", "running"]);
  });

  it("groups running before alive-quiet before ready", () => {
    const ready = buildSession({ id: "ready", state: "ready", lastOutputAt: 900 });
    const quiet = buildSession({ id: "quiet", state: "alive-quiet", lastOutputAt: 900 });
    const running = buildSession({ id: "running", state: "running", lastOutputAt: 100 });
    const ordered = sortSessions([ready, quiet, running], null, "");
    expect(ordered.map((session) => session.id)).toEqual(["running", "quiet", "ready"]);
  });

  it("sorts by most-recent lastOutputAt within an activity group", () => {
    const older = buildSession({ id: "older", state: "running", lastOutputAt: 100 });
    const newer = buildSession({ id: "newer", state: "running", lastOutputAt: 500 });
    const ordered = sortSessions([older, newer], null, "");
    expect(ordered.map((session) => session.id)).toEqual(["newer", "older"]);
  });

  it("floats this profile's sessions above other profiles' within an activity group", () => {
    const own = buildSession({
      id: "own",
      state: "ready",
      lastOutputAt: 100,
      clients: 1,
      clientProfiles: [{ windowId: "me", count: 1 }],
    });
    const other = buildSession({
      id: "other",
      state: "ready",
      lastOutputAt: 900,
      clients: 1,
      clientProfiles: [{ windowId: "them", count: 1 }],
    });
    const ordered = sortSessions([other, own], null, "", "me");
    expect(ordered.map((session) => session.id)).toEqual(["own", "other"]);
  });

  it("filters by title, cwd, or shell before sorting", () => {
    const alpha = buildSession({ id: "alpha", title: "alpha", state: "running", lastOutputAt: 1 });
    const beta = buildSession({ id: "beta", cwd: "/beta", state: "ready", lastOutputAt: 2 });
    const gamma = buildSession({
      id: "gamma",
      shellName: "fish",
      state: "alive-quiet",
      lastOutputAt: 3,
    });
    expect(sortSessions([alpha, beta, gamma], null, "beta").map((session) => session.id)).toEqual([
      "beta",
    ]);
    expect(sortSessions([alpha, beta, gamma], null, "fish").map((session) => session.id)).toEqual([
      "gamma",
    ]);
  });
});
