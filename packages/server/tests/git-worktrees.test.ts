import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vite-plus/test";
import { createGitWorktree, listGitWorktrees, removeGitWorktree } from "../src/git-worktrees.js";
import { generateWorktreeName } from "../src/utils/worktree-names.js";

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

const makeTempDir = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), "localterm-worktree-test-"));

interface TestRepo {
  dir: string;
}

const initRepo = async (dir: string): Promise<TestRepo> => {
  runGitSync(dir, ["init", "-b", "main"]);
  return { dir };
};

const commitAll = async (repo: TestRepo, message: string): Promise<void> => {
  runGitSync(repo.dir, ["add", "-A"]);
  runGitSync(repo.dir, ["commit", "-m", message]);
};

const getHeadSha = (dir: string): string => runGitSync(dir, ["rev-parse", "HEAD"]).trim();

// Auto-created worktrees land under ~/.localterm/worktrees/<project>/, so the
// project name (basename of the repo's main worktree root) drives the base dir
// the test must clean up.
const worktreesBaseDirFor = (repo: TestRepo): string =>
  path.join(os.homedir(), ".localterm", "worktrees", path.basename(fs.realpathSync(repo.dir)));

const realPath = (dir: string): string => fs.realpathSync(dir);

const expectedDisplayPath = (absolutePath: string): string => {
  const resolved = realPath(absolutePath);
  return resolved.startsWith(`${os.homedir()}${path.sep}`)
    ? `~${resolved.slice(os.homedir().length)}`
    : resolved;
};

describe("listGitWorktrees", () => {
  it("reports a non-repo directory", async () => {
    const plainDir = makeTempDir();
    try {
      expect(await listGitWorktrees(plainDir)).toEqual({
        isRepo: false,
        worktrees: [],
        displayBaseDir: null,
      });
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });

  it("lists the main worktree, marks it current and main, and reports the tildified base dir", async () => {
    const repo = await initRepo(makeTempDir());
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      const sha = getHeadSha(repo.dir);

      const result = await listGitWorktrees(repo.dir);
      expect(result.isRepo).toBe(true);
      expect(result.displayBaseDir).toBe(
        `~/.localterm/worktrees/${path.basename(realPath(repo.dir))}`,
      );
      expect(result.worktrees).toHaveLength(1);
      expect(result.worktrees[0]).toEqual({
        path: realPath(repo.dir),
        displayPath: expectedDisplayPath(repo.dir),
        branch: "main",
        head: sha,
        isCurrent: true,
        isMain: true,
        isLocked: false,
        isPrunable: false,
      });
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("lists added worktrees: main flagged, linked not main, detached/locked", async () => {
    const repo = await initRepo(makeTempDir());
    const featurePath = path.join(repo.dir, "..", "wt-feature");
    const detachedPath = path.join(repo.dir, "..", "wt-detached");
    const lockedPath = path.join(repo.dir, "..", "wt-locked");
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");

      runGitSync(repo.dir, ["worktree", "add", "-b", "feature", featurePath]);
      runGitSync(repo.dir, ["worktree", "add", "--detach", detachedPath]);
      runGitSync(repo.dir, ["worktree", "add", "-b", "locked-branch", lockedPath]);
      runGitSync(repo.dir, ["worktree", "lock", lockedPath]);

      const result = await listGitWorktrees(repo.dir);
      const byPath = new Map(result.worktrees.map((worktree) => [worktree.path, worktree]));

      expect(result.worktrees).toHaveLength(4);
      expect(byPath.get(realPath(repo.dir))?.isCurrent).toBe(true);
      expect(byPath.get(realPath(repo.dir))?.isMain).toBe(true);

      const feature = byPath.get(realPath(featurePath));
      expect(feature?.branch).toBe("feature");
      expect(feature?.isCurrent).toBe(false);
      expect(feature?.isMain).toBe(false);
      expect(feature?.isLocked).toBe(false);

      const detached = byPath.get(realPath(detachedPath));
      expect(detached?.branch).toBeNull();
      expect(detached?.head).not.toBeNull();
      expect(detached?.isMain).toBe(false);

      const locked = byPath.get(realPath(lockedPath));
      expect(locked?.isLocked).toBe(true);
      expect(locked?.branch).toBe("locked-branch");
      expect(locked?.isMain).toBe(false);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(featurePath, { recursive: true, force: true });
      fs.rmSync(detachedPath, { recursive: true, force: true });
      fs.rmSync(lockedPath, { recursive: true, force: true });
    }
  });
});

describe("createGitWorktree", () => {
  it("creates a worktree under ~/.localterm/worktrees/<project>/ on a memorable branch name", async () => {
    const repo = await initRepo(makeTempDir());
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");

      const result = await createGitWorktree(repo.dir);
      expect(result.branch).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
      expect(result.path).toBe(path.join(baseDir, result.branch));
      expect(fs.existsSync(path.join(result.path, "a.txt"))).toBe(true);

      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees).toHaveLength(2);
      expect(list.worktrees.some((worktree) => worktree.branch === result.branch)).toBe(true);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("creates two worktrees with distinct memorable names", async () => {
    const repo = await initRepo(makeTempDir());
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");

      const first = await createGitWorktree(repo.dir);
      const second = await createGitWorktree(repo.dir);
      expect(first.branch).not.toBe(second.branch);
      expect(first.path).not.toBe(second.path);

      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees).toHaveLength(3);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("puts same-named repos in distinct project folders", async () => {
    // Two repos whose main worktree basename is identical but whose paths
    // differ must not share a worktrees folder: the second lands in a hashed
    // sibling so its worktrees never collide with the first's.
    const parentA = makeTempDir();
    const parentB = makeTempDir();
    const repoADir = path.join(parentA, "same-name");
    const repoBDir = path.join(parentB, "same-name");
    fs.mkdirSync(repoADir, { recursive: true });
    fs.mkdirSync(repoBDir, { recursive: true });
    const repoA = await initRepo(repoADir);
    const repoB = await initRepo(repoBDir);
    try {
      for (const repo of [repoA, repoB]) {
        fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
        await commitAll(repo, "base");
      }

      const createdA = await createGitWorktree(repoA.dir);
      const createdB = await createGitWorktree(repoB.dir);

      expect(path.dirname(createdA.path)).not.toBe(path.dirname(createdB.path));
      // Each repo sees only its own worktree in its own project folder.
      const listA = await listGitWorktrees(repoA.dir);
      const listB = await listGitWorktrees(repoB.dir);
      expect(listA.worktrees).toHaveLength(2);
      expect(listB.worktrees).toHaveLength(2);
      expect(listA.worktrees.some((wt) => wt.path === createdA.path)).toBe(true);
      expect(listB.worktrees.some((wt) => wt.path === createdB.path)).toBe(true);
      expect(listA.worktrees.some((wt) => wt.path === createdB.path)).toBe(false);
      expect(listB.worktrees.some((wt) => wt.path === createdA.path)).toBe(false);
    } finally {
      fs.rmSync(parentA, { recursive: true, force: true });
      fs.rmSync(parentB, { recursive: true, force: true });
      fs.rmSync(path.join(os.homedir(), ".localterm", "worktrees", "same-name"), {
        recursive: true,
        force: true,
      });
    }
  });
});

describe("createGitWorktree options", () => {
  it("baseRef head branches from local HEAD and reports no copied files without a .worktreeinclude", async () => {
    const repo = await initRepo(makeTempDir());
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");

      const result = await createGitWorktree(repo.dir, { baseRef: "head" });
      expect(result.branch).toMatch(/^[a-z]+-[a-z]+(-\d+)?$/);
      expect(result.copiedFiles).toEqual([]);
      expect(fs.existsSync(path.join(result.path, "a.txt"))).toBe(true);
      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees.some((worktree) => worktree.branch === result.branch)).toBe(true);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("creates a pr-<N> worktree from pull/<N>/head against a local bare origin", async () => {
    const repo = await initRepo(makeTempDir());
    const originDir = makeTempDir();
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      const headSha = getHeadSha(repo.dir);

      runGitSync(originDir, ["init", "--bare"]);
      runGitSync(repo.dir, ["remote", "add", "origin", originDir]);
      runGitSync(repo.dir, ["push", "-q", "origin", "main"]);
      // Expose a GitHub-style pull request head ref on the bare origin.
      runGitSync(originDir, ["update-ref", "refs/pull/42/head", headSha]);

      const result = await createGitWorktree(repo.dir, { pullRequestNumber: 42 });
      expect(result.branch).toBe("pr-42");
      expect(path.basename(result.path)).toBe("pr-42");
      expect(fs.existsSync(path.join(result.path, "a.txt"))).toBe(true);

      const list = await listGitWorktrees(repo.dir);
      const prWorktree = list.worktrees.find((worktree) => worktree.branch === "pr-42");
      expect(prWorktree).toBeDefined();
      expect(prWorktree?.path).toBe(result.path);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(originDir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("surfaces a clear error when a PR head can't be fetched (no origin)", async () => {
    const repo = await initRepo(makeTempDir());
    const baseDir = worktreesBaseDirFor(repo);
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");

      await expect(createGitWorktree(repo.dir, { pullRequestNumber: 7 })).rejects.toThrow(
        /PR #7|fetch/i,
      );
      // Nothing was created.
      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees).toHaveLength(1);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

describe("removeGitWorktree", () => {
  it("removes a non-current linked worktree", async () => {
    const repo = await initRepo(makeTempDir());
    const targetPath = path.join(repo.dir, "..", "wt-rm");
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      runGitSync(repo.dir, ["worktree", "add", "-b", "tmp", targetPath]);

      await removeGitWorktree(repo.dir, targetPath);

      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees).toHaveLength(1);
      expect(list.worktrees[0].branch).toBe("main");
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
  });

  it("refuses to remove the main worktree even from a linked worktree", async () => {
    const repo = await initRepo(makeTempDir());
    const linkedPath = path.join(repo.dir, "..", "wt-linked");
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      runGitSync(repo.dir, ["worktree", "add", "-b", "linked", linkedPath]);

      // Invoking remove from inside the linked worktree, targeting the main
      // worktree's path — the server must refuse regardless of caller cwd.
      await expect(removeGitWorktree(linkedPath, repo.dir)).rejects.toThrow(
        /can't remove the main worktree/i,
      );

      // Neither worktree was removed.
      const list = await listGitWorktrees(repo.dir);
      expect(list.worktrees).toHaveLength(2);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
      fs.rmSync(linkedPath, { recursive: true, force: true });
    }
  });
});

describe("generateWorktreeName", () => {
  it("produces a memorable adjective-noun phrase", () => {
    const name = generateWorktreeName(new Set());
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("avoids names already taken, falling back to a counter suffix", () => {
    const taken = new Set<string>();
    const generated: string[] = [];
    for (let i = 0; i < 1000; i++) {
      const name = generateWorktreeName(taken);
      expect(taken.has(name)).toBe(false);
      taken.add(name);
      generated.push(name);
    }
    // The vast majority are bare adjective-noun; the counter suffix only appears
    // once the random space is exhausted for specific pairs.
    expect(generated.filter((name) => name.split("-").length === 2).length).toBeGreaterThan(900);
  });
});
