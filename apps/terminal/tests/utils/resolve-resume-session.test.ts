import { describe, expect, it } from "vite-plus/test";
import type { SessionListItem } from "@monotykamary/localterm-server/protocol";
import { resolveResumeSession } from "../../src/utils/resolve-resume-session.js";

const session = (id: string, lastOutputAt: number): SessionListItem => ({
  id,
  pid: 1,
  shell: "/bin/zsh",
  shellName: "zsh",
  cwd: "/home",
  title: "home",
  createdAt: 0,
  lastOutputAt,
  clients: 1,
  state: "ready",
  pinned: false,
});

describe("resolveResumeSession", () => {
  it("returns null when no sessions are live", () => {
    expect(resolveResumeSession([])).toBeNull();
  });

  it("picks the most recently active session (highest lastOutputAt)", () => {
    const sessions = [session("idle", 1_000), session("active", 5_000), session("stale", 500)];
    expect(resolveResumeSession(sessions)).toBe("active");
  });

  it("falls back to the first session on a tie", () => {
    const sessions = [session("first", 1_000), session("second", 1_000)];
    expect(resolveResumeSession(sessions)).toBe("first");
  });

  it("picks a single session unchanged", () => {
    expect(resolveResumeSession([session("only", 42)])).toBe("only");
  });
});
