import { describe, expect, it } from "vite-plus/test";
import type { SessionListItem } from "@monotykamary/localterm-server/protocol";
import { resolveInitialSessionIndex } from "../../src/utils/resolve-initial-session-index";

const buildSession = (id: string): SessionListItem => ({
  id,
  pid: 1,
  shell: "/bin/zsh",
  shellName: "zsh",
  cwd: "/tmp",
  title: id,
  createdAt: 0,
  lastOutputAt: 0,
  clients: 0,
  state: "ready",
  pinned: false,
});

describe("resolveInitialSessionIndex", () => {
  it("returns 0 for an empty list", () => {
    expect(resolveInitialSessionIndex([], null, null)).toBe(0);
  });

  it("selects the previous session when it is in the list", () => {
    const ordered = [buildSession("current"), buildSession("previous"), buildSession("other")];
    expect(resolveInitialSessionIndex(ordered, "previous", "current")).toBe(1);
  });

  it("falls back to the first non-current row when the previous session was reaped", () => {
    const ordered = [buildSession("current"), buildSession("a"), buildSession("b")];
    expect(resolveInitialSessionIndex(ordered, "reaped", "current")).toBe(1);
  });

  it("falls back to the first non-current row when no previous session is recorded", () => {
    const ordered = [buildSession("current"), buildSession("a"), buildSession("b")];
    expect(resolveInitialSessionIndex(ordered, null, "current")).toBe(1);
  });

  it("returns 0 when only the current session is listed", () => {
    expect(resolveInitialSessionIndex([buildSession("current")], null, "current")).toBe(0);
  });

  it("returns 0 when no current session is set and no previous session is recorded", () => {
    const ordered = [buildSession("a"), buildSession("b")];
    expect(resolveInitialSessionIndex(ordered, null, null)).toBe(0);
  });
});
