import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { copyWorktreeIncludes } from "../src/utils/copy-worktree-includes.js";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const GIT_ENV = {
  ...process.env,
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

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "localterm-wtinclude-"));

const initRepo = (dir: string): void => {
  runGitSync(dir, ["init", "-b", "main"]);
};

const commitAll = (dir: string, message: string): void => {
  runGitSync(dir, ["add", "-A"]);
  runGitSync(dir, ["commit", "-m", message]);
};

describe("copyWorktreeIncludes", () => {
  it("copies gitignored files named in .worktreeinclude and never tracked files", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const dest = makeTempDir();
    try {
      fs.writeFileSync(path.join(repo, "tracked.txt"), "tracked\n");
      fs.writeFileSync(path.join(repo, ".gitignore"), ".env\nconfig/secrets.json\nnode_modules/\n");
      fs.writeFileSync(path.join(repo, ".env"), "SECRET=1\n");
      fs.mkdirSync(path.join(repo, "config"), { recursive: true });
      fs.writeFileSync(path.join(repo, "config", "secrets.json"), '{"k":"v"}\n');
      fs.mkdirSync(path.join(repo, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(repo, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");

      fs.writeFileSync(path.join(repo, ".worktreeinclude"), ".env\nconfig/secrets.json\n");
      commitAll(repo, "base");

      const copied = await copyWorktreeIncludes(repo, dest);
      expect(copied.sort()).toEqual([".env", "config/secrets.json"]);
      expect(fs.existsSync(path.join(dest, ".env"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "config", "secrets.json"))).toBe(true);
      expect(fs.existsSync(path.join(dest, "tracked.txt"))).toBe(false);
      expect(fs.existsSync(path.join(dest, "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("returns nothing when the repo has no .worktreeinclude", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const dest = makeTempDir();
    try {
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      commitAll(repo, "base");
      const copied = await copyWorktreeIncludes(repo, dest);
      expect(copied).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });

  it("returns nothing when a pattern matches nothing ignored", async () => {
    const repo = makeTempDir();
    initRepo(repo);
    const dest = makeTempDir();
    try {
      fs.writeFileSync(path.join(repo, ".worktreeinclude"), "nonexistent.env\n");
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      commitAll(repo, "base");
      const copied = await copyWorktreeIncludes(repo, dest);
      expect(copied).toEqual([]);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});
