import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createGitWorktree, listGitWorktrees } from "../src/git-worktrees.js";
import { sweepStaleWorktrees } from "../src/utils/worktree-sweep.js";
import { cleanupWorktreeTestLeftovers } from "./worktree-test-cleanup.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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
  const result = spawnSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} (in ${cwd}) failed: ${result.stderr ?? result.stdout}`);
  }
  return result.stdout ?? "";
};

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "localterm-wtsweep-"));

const initRepo = (dir: string): void => {
  runGitSync(dir, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  runGitSync(dir, ["add", "-A"]);
  runGitSync(dir, ["commit", "-m", "base"]);
};

const worktreesBaseDirFor = (repoDir: string): string =>
  path.join(os.homedir(), ".localterm", "worktrees", path.basename(fs.realpathSync(repoDir)));

const MS_PER_DAY_MS = 24 * 60 * 60 * 1000;

// Set a directory's mtime far enough in the past to clear the sweep cutoff.
const backdateDir = (dir: string, daysAgo: number): void => {
  const past = new Date(Date.now() - daysAgo * MS_PER_DAY_MS);
  fs.utimesSync(dir, past, past);
};

beforeAll(cleanupWorktreeTestLeftovers);

describe("sweepStaleWorktrees", () => {
  it("removes a stale clean auto-created worktree and leaves the main one", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const created = await createGitWorktree(repo, { baseRef: "head" });
      backdateDir(created.path, 31);

      const result = await sweepStaleWorktrees(repo);
      expect(result.removed).toEqual([created.path]);

      const list = await listGitWorktrees(repo);
      expect(list.worktrees).toHaveLength(1);
      expect(list.worktrees[0].branch).toBe("main");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps a stale worktree that has uncommitted changes", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const created = await createGitWorktree(repo, { baseRef: "head" });
      fs.writeFileSync(path.join(created.path, "uncommitted.txt"), "x\n");
      backdateDir(created.path, 31);

      const result = await sweepStaleWorktrees(repo);
      expect(result.removed).toEqual([]);

      const list = await listGitWorktrees(repo);
      expect(list.worktrees).toHaveLength(2);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps a recent worktree regardless of cleanliness", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const created = await createGitWorktree(repo, { baseRef: "head" });
      // Fresh mtime — within the cutoff.
      backdateDir(created.path, 1);

      const result = await sweepStaleWorktrees(repo);
      expect(result.removed).toEqual([]);

      const list = await listGitWorktrees(repo);
      expect(list.worktrees.some((worktree) => worktree.path === created.path)).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps a stale clean worktree a shell is still open in", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const created = await createGitWorktree(repo, { baseRef: "head" });
      backdateDir(created.path, 31);

      // An active PTY on the worktree (modeled by the predicate) must block
      // the sweep just like the manual delete — even though the worktree is
      // old and clean.
      const result = await sweepStaleWorktrees(repo, Date.now(), (p) => p === created.path);
      expect(result.removed).toEqual([]);

      const list = await listGitWorktrees(repo);
      expect(list.worktrees.some((worktree) => worktree.path === created.path)).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("reaps the project folder once its last worktree is swept", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const created = await createGitWorktree(repo, { baseRef: "head" });
      backdateDir(created.path, 31);

      await sweepStaleWorktrees(repo);

      expect(fs.existsSync(created.path)).toBe(false);
      expect(fs.existsSync(baseDir)).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("keeps the project folder when a sibling worktree stays", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const baseDir = worktreesBaseDirFor(repo);
    try {
      const swept = await createGitWorktree(repo, { baseRef: "head" });
      const kept = await createGitWorktree(repo, { baseRef: "head" });
      backdateDir(swept.path, 31);

      await sweepStaleWorktrees(repo);

      expect(fs.existsSync(swept.path)).toBe(false);
      expect(fs.existsSync(kept.path)).toBe(true);
      expect(fs.existsSync(baseDir)).toBe(true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
