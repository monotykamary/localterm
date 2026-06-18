import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vite-plus/test";
import { WORKTREEINCLUDE_FILENAME } from "../src/constants.js";
import {
  readWorktreeIncludeFile,
  writeWorktreeIncludeFile,
} from "../src/utils/worktree-include-file.js";

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

describe("readWorktreeIncludeFile", () => {
  it("returns exists: false when the repo has no .worktreeinclude", async () => {
    const repo = makeTempDir();
    try {
      initRepo(repo);
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      commitAll(repo, "base");
      const file = await readWorktreeIncludeFile(repo);
      expect(file).toEqual({
        exists: false,
        content: "",
        path: WORKTREEINCLUDE_FILENAME,
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("reads the existing .worktreeinclude content", async () => {
    const repo = makeTempDir();
    try {
      initRepo(repo);
      fs.writeFileSync(path.join(repo, ".worktreeinclude"), ".env\nconfig/secrets.json\n");
      commitAll(repo, "base");
      const file = await readWorktreeIncludeFile(repo);
      expect(file).toEqual({
        exists: true,
        content: ".env\nconfig/secrets.json\n",
        path: WORKTREEINCLUDE_FILENAME,
      });
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns null when the cwd is not inside a git repository", async () => {
    const dir = makeTempDir();
    try {
      const file = await readWorktreeIncludeFile(dir);
      expect(file).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("writeWorktreeIncludeFile", () => {
  it("creates a .worktreeinclude file with trimmed content", async () => {
    const repo = makeTempDir();
    try {
      initRepo(repo);
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      commitAll(repo, "base");
      const file = await writeWorktreeIncludeFile(repo, "  .env\nconfig/secrets.json  \n");
      expect(file).toEqual({
        exists: true,
        content: ".env\nconfig/secrets.json",
        path: WORKTREEINCLUDE_FILENAME,
      });
      const onDisk = fs.readFileSync(path.join(repo, WORKTREEINCLUDE_FILENAME), "utf8");
      expect(onDisk).toBe(".env\nconfig/secrets.json\n");
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("removes the file when the content is empty or whitespace-only", async () => {
    const repo = makeTempDir();
    try {
      initRepo(repo);
      fs.writeFileSync(path.join(repo, ".worktreeinclude"), ".env\n");
      commitAll(repo, "base");
      const file = await writeWorktreeIncludeFile(repo, "   \n");
      expect(file).toEqual({
        exists: false,
        content: "",
        path: WORKTREEINCLUDE_FILENAME,
      });
      expect(fs.existsSync(path.join(repo, WORKTREEINCLUDE_FILENAME))).toBe(false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("returns null when the cwd is not inside a git repository", async () => {
    const dir = makeTempDir();
    try {
      const file = await writeWorktreeIncludeFile(dir, ".env\n");
      expect(file).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
