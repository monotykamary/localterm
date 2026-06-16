import { describe, expect, it } from "vite-plus/test";
import {
  anySessionRunsTrigger,
  commandMatchesTriggers,
  type ProcessSnapshotEntry,
} from "../src/caffeinate-process-match.js";

const triggers = new Set(["claude", "codex", "opencode", "pi"]);

describe("commandMatchesTriggers", () => {
  it("matches a bare binary name", () => {
    expect(commandMatchesTriggers("claude --foo", triggers)).toBe("claude");
  });

  it("matches a node-launched CLI by the script basename", () => {
    expect(commandMatchesTriggers("node /opt/homebrew/bin/claude --resume", triggers)).toBe(
      "claude",
    );
  });

  it("matches an absolute path to the binary", () => {
    expect(commandMatchesTriggers("/usr/local/bin/codex", triggers)).toBe("codex");
  });

  it("is case-insensitive", () => {
    expect(commandMatchesTriggers("CodeX", triggers)).toBe("codex");
  });

  it("matches a script launched by its .js shim", () => {
    expect(commandMatchesTriggers("node /opt/homebrew/bin/codex.js --prompt hello", triggers)).toBe(
      "codex",
    );
  });

  it("matches a versioned binary by a parent directory segment", () => {
    expect(commandMatchesTriggers("/opt/claude/versions/2.1.178", triggers)).toBe("claude");
  });

  it("does not match a trigger as a substring of a path segment", () => {
    expect(commandMatchesTriggers("/opt/not-claude/bin/run", triggers)).toBeNull();
    expect(commandMatchesTriggers("/opt/pinetry/bin/run", triggers)).toBeNull();
    // `pi` must match a whole token basename, not appear inside "raspi".
    expect(commandMatchesTriggers("node /usr/bin/raspimon", triggers)).toBeNull();
  });

  it("does not match an unrelated command", () => {
    expect(commandMatchesTriggers("vim notes.md", triggers)).toBeNull();
  });

  it("never matches with an empty trigger set", () => {
    expect(commandMatchesTriggers("claude", new Set())).toBeNull();
  });
});

describe("anySessionRunsTrigger", () => {
  const snapshot: ProcessSnapshotEntry[] = [
    { pid: 100, ppid: 1, command: "-zsh" },
    { pid: 200, ppid: 100, command: "node /opt/homebrew/bin/claude" },
    { pid: 300, ppid: 1, command: "node /opt/homebrew/bin/claude" }, // not under a session
    { pid: 400, ppid: 999, command: "vim" },
  ];

  it("matches a descendant of a session shell", () => {
    expect(anySessionRunsTrigger([100], snapshot, triggers)).toBe("claude");
  });

  it("ignores a matching process that is not under any session", () => {
    expect(anySessionRunsTrigger([999], snapshot, triggers)).toBeNull();
  });

  it("returns null with no sessions", () => {
    expect(anySessionRunsTrigger([], snapshot, triggers)).toBeNull();
  });

  it("walks deeper descendants, not just direct children", () => {
    const deep: ProcessSnapshotEntry[] = [
      { pid: 100, ppid: 1, command: "-zsh" },
      { pid: 200, ppid: 100, command: "npm exec" },
      { pid: 300, ppid: 200, command: "node /usr/local/bin/opencode" },
    ];
    expect(anySessionRunsTrigger([100], deep, triggers)).toBe("opencode");
  });

  it("does not match the session shell itself", () => {
    const shellOnly: ProcessSnapshotEntry[] = [{ pid: 100, ppid: 1, command: "claude" }];
    // pid 100 is the session root; its own command is never matched.
    expect(anySessionRunsTrigger([100], shellOnly, triggers)).toBeNull();
  });
});
