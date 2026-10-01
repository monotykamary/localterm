import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { spawnPty } from "../src/pty-backend.js";
import { Session } from "../src/session.js";
import { SessionManager } from "../src/session-manager.js";
import { SessionSpawnError } from "../src/session-spawn-error.js";
import { ShellHookBuilder } from "../src/shell-hook-builder.js";

vi.mock("../src/pty-backend.js", () => ({ spawnPty: vi.fn() }));
vi.mock("../src/ensure-spawn-helper-executable.js", () => ({
  ensureSpawnHelperExecutable: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("failed PTY allocation", () => {
  it("removes temporary shell hooks and preserves the native cause", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-failed-spawn-"));
    const cause = new Error("posix_spawnp failed: No such device or address");
    vi.mocked(spawnPty).mockImplementation(() => {
      throw cause;
    });
    vi.spyOn(ShellHookBuilder.prototype, "prepare").mockImplementation(
      function (this: ShellHookBuilder) {
        this.hookCleanupPaths.push(directory);
        return [[], null];
      },
    );
    try {
      let failure: unknown;
      try {
        new Session({ shell: "/bin/sh" });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(SessionSpawnError);
      expect(failure).toMatchObject({ cause });
      expect(fs.existsSync(directory)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never registers a failed spawn or broadcasts it as an active session", () => {
    vi.mocked(spawnPty).mockImplementation(() => {
      throw new Error("allocation failed");
    });
    vi.spyOn(ShellHookBuilder.prototype, "prepare").mockReturnValue([[], null]);
    const onSessionActivity = vi.fn();
    const manager = new SessionManager({
      getGraceMs: () => 0,
      sendControl: vi.fn(),
      hooks: {
        onOutputActivity: vi.fn(),
        onSessionActivity,
        onSessionEvent: vi.fn(),
        onAutomationExit: vi.fn(),
        onClientExit: vi.fn(),
      },
    });
    try {
      expect(() => manager.spawnDetached({ shell: "/bin/sh" }, true)).toThrow(SessionSpawnError);
      expect(manager.size()).toBe(0);
      expect(manager.list()).toEqual([]);
      expect(onSessionActivity).not.toHaveBeenCalled();
    } finally {
      manager.disposeAll();
    }
  });
});
