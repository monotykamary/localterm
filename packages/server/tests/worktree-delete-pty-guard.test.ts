import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { WebSocket } from "ws";
import { createServer, type RunningServer } from "../src/index.js";

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_PAGER: "",
  GIT_TERMINAL_PROMPT: "0",
};

const runGitSync = (cwd: string, args: string[]): string => {
  const result = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr ?? result.stdout}`);
  }
  return result.stdout ?? "";
};

const initRepo = (dir: string): void => {
  runGitSync(dir, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  runGitSync(dir, ["add", "-A"]);
  runGitSync(dir, ["commit", "-m", "base"]);
};

// A shell opened in a worktree is a live PTY at that cwd the moment the
// session frame lands — lastEmittedCwd is seeded to the spawn cwd at
// construction, before any OSC7 arrives — so the guard reads it immediately.
const openShellIn = (port: number, cwd: string): Promise<{ socket: WebSocket; id: string }> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ws connect timeout")), 10_000);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?cwd=${encodeURIComponent(cwd)}`);
    socket.binaryType = "arraybuffer";
    socket.addEventListener("message", function listener(event) {
      if (event.data instanceof ArrayBuffer) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        (parsed as Record<string, unknown>).type === "session"
      ) {
        clearTimeout(timer);
        socket.removeEventListener("message", listener);
        resolve({ socket, id: (parsed as { id: string }).id });
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("ws error"));
    });
  });

const closeWs = (socket: WebSocket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.addEventListener("close", () => resolve());
    socket.close();
  });

describe("worktree delete guard (active PTY)", () => {
  let server: RunningServer;
  let repoDir: string;
  let worktreeDir: string;
  let stateDirectory: string;

  beforeEach(async () => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-wtguard-"));
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-wtrepo-"));
    initRepo(repoDir);
    // A linked worktree at an arbitrary temp path (not under ~/.localterm) so
    // the test never touches the user's real worktrees dir.
    worktreeDir = path.join(path.dirname(repoDir), "localterm-linked-wt");
    runGitSync(repoDir, ["worktree", "add", "-b", "feature", worktreeDir]);

    server = await createServer({
      port: 0,
      host: "127.0.0.1",
      stateDirectory,
      tabController: { open: async () => null, close: async () => {} },
    });
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  });

  const deleteWorktree = async (): Promise<{ status: number; body: Record<string, unknown> }> => {
    const url = `http://127.0.0.1:${server.port}/api/git/worktrees?cwd=${encodeURIComponent(repoDir)}&path=${encodeURIComponent(worktreeDir)}`;
    const response = await fetch(url, { method: "DELETE" });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };

  it("refuses to remove a worktree a shell is open in, including a parked one, then allows it once killed", async () => {
    const { socket, id } = await openShellIn(server.port, worktreeDir);
    try {
      expect(server.registry.size()).toBe(1);

      // An attached PTY sits in the worktree → removal is refused (409).
      const blocked = await deleteWorktree();
      expect(blocked.status).toBe(409);
      expect(blocked.body.error).toBe("active_pty");
      expect(String(blocked.body.message)).toMatch(/still open in this worktree/i);

      // Close the tab: the PTY detaches and parks with no clients — still a
      // live process the session picker can re-attach to, so removal must stay
      // refused.
      await closeWs(socket);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(server.registry.size()).toBe(1);
      const blockedWhileParked = await deleteWorktree();
      expect(blockedWhileParked.status).toBe(409);

      // Kill the parked PTY from the session picker; with no shell left,
      // removal finally succeeds.
      const killResponse = await fetch(`http://127.0.0.1:${server.port}/api/sessions/${id}`, {
        method: "DELETE",
      });
      expect(killResponse.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(server.registry.size()).toBe(0);

      const removed = await deleteWorktree();
      expect(removed.status).toBe(200);
      expect(removed.body).toEqual({ ok: true });
      expect(fs.existsSync(worktreeDir)).toBe(false);
    } finally {
      // If an assertion failed mid-flow the PTY may still be live; ensure the
      // shell exits so afterEach's worktree cleanup isn't racing a live cwd.
      if (server.registry.size() > 0) {
        await fetch(`http://127.0.0.1:${server.port}/api/sessions/${id}`, { method: "DELETE" });
      }
    }
  }, 15_000);

  it("removes a worktree no shell is open in", async () => {
    const removed = await deleteWorktree();
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ ok: true });
    expect(fs.existsSync(worktreeDir)).toBe(false);
  }, 10_000);
});
