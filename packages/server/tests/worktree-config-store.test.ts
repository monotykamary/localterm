import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { WorktreeConfigStore, worktreeConfigPathFor } from "../src/worktree-config-store.js";
import { mainWorktreeRoot } from "../src/git-worktrees.js";

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

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "localterm-wtcfg-"));

const initRepo = (dir: string): void => {
  runGitSync(dir, ["init", "-b", "main"]);
  runGitSync(dir, ["config", "user.email", "test@example.com"]);
  runGitSync(dir, ["config", "user.name", "test"]);
  fs.writeFileSync(path.join(dir, "a.txt"), "a\n");
  runGitSync(dir, ["add", "-A"]);
  runGitSync(dir, ["commit", "-m", "base"]);
};

describe("WorktreeConfigStore", () => {
  it("returns defaults for a repo with no saved config", async () => {
    const stateDir = makeTempDir();
    const repo = makeTempDir();
    initRepo(repo);
    try {
      const store = new WorktreeConfigStore(stateDir);
      const config = await store.get(repo);
      expect(config).toEqual({
        setupScript: "",
        openInCommands: [],
        baseRef: "fresh",
      });
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("persists and reloads edits, merging into prior values", async () => {
    const stateDir = makeTempDir();
    const repo = makeTempDir();
    initRepo(repo);
    try {
      const store = new WorktreeConfigStore(stateDir);
      const saved = await store.update(repo, {
        setupScript: "pnpm install",
        baseRef: "head",
      });
      expect(saved.setupScript).toBe("pnpm install");
      expect(saved.baseRef).toBe("head");

      const mainRoot = await mainWorktreeRoot(repo);
      expect(mainRoot).not.toBeNull();
      const configPath = worktreeConfigPathFor(stateDir, mainRoot as string);
      expect(fs.existsSync(configPath)).toBe(true);

      const reloaded = await new WorktreeConfigStore(stateDir).get(repo);
      expect(reloaded.setupScript).toBe("pnpm install");
      expect(reloaded.baseRef).toBe("head");

      // A subsequent update merges into the persisted values.
      const merged = await store.update(repo, {
        openInCommands: [{ id: "code", label: "VS Code", command: "code ." }],
      });
      expect(merged.setupScript).toBe("pnpm install");
      expect(merged.baseRef).toBe("head");
      expect(merged.openInCommands).toHaveLength(1);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("sanitizes open-in commands: drops empties and dedupes by id", async () => {
    const stateDir = makeTempDir();
    const repo = makeTempDir();
    initRepo(repo);
    try {
      const store = new WorktreeConfigStore(stateDir);
      const saved = await store.update(repo, {
        openInCommands: [
          { id: "code", label: "VS Code", command: "code ." },
          { id: "code", label: "Code (dup)", command: "code ." },
          { id: "empty", label: "", command: "x" },
          { id: "fork", label: "Fork", command: "fork ." },
        ],
      });
      expect(saved.openInCommands).toEqual([
        { id: "code", label: "Code (dup)", command: "code ." },
        { id: "fork", label: "Fork", command: "fork ." },
      ]);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
