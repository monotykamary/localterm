import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import {
  buildUntrackedPatch,
  getGitBranchInfo,
  getGitBranchPr,
  listGithubRemoteSlugs,
  getGitDiff,
  getGitDiffFilePatch,
  getGitDiffFiles,
  getGitDiffSummary,
  parseNameStatusZ,
  parseNumstatZ,
  setPrFetcher,
  splitPatchByFile,
} from "../src/git-diff.js";

// These tests drive real `git` subprocesses (init/commit/diff on tmp repos) and
// the git-diff module shells out on every cold cache miss. That's fast in
// isolation but contended under `pnpm test`'s full parallel run (chromium
// boots alongside), so grant the same headroom the other I/O-heavy suites use.
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

interface TestRepo {
  dir: string;
}

const initRepo = async (dir: string): Promise<TestRepo> => {
  runGitSync(dir, ["init", "-b", "main"]);
  return { dir };
};

const commitAll = async (testRepo: TestRepo, message: string): Promise<void> => {
  runGitSync(testRepo.dir, ["add", "-A"]);
  runGitSync(testRepo.dir, ["commit", "-m", message]);
};

const stageRename = (testRepo: TestRepo, oldFilePath: string, newFilePath: string): void => {
  runGitSync(testRepo.dir, ["mv", oldFilePath, newFilePath]);
};

const checkoutBranch = (testRepo: TestRepo, branchName: string): void => {
  runGitSync(testRepo.dir, ["checkout", branchName]);
};

const createAndCheckoutBranch = (testRepo: TestRepo, branchName: string): void => {
  runGitSync(testRepo.dir, ["checkout", "-b", branchName]);
};

const addRemote = (testRepo: TestRepo, name: string, url: string): void => {
  runGitSync(testRepo.dir, ["remote", "add", name, url]);
};

const stagePath = (testRepo: TestRepo, filePath: string): void => {
  runGitSync(testRepo.dir, ["add", filePath]);
};

const getHeadSha = (dir: string): string => runGitSync(dir, ["rev-parse", "HEAD"]).trim();

// Simulate a remote-tracking branch pointing at an arbitrary SHA, without
// needing a second repo to fetch from. Lets a fixture model fork/upstream layout
// (origin/main vs upstream/main at different commits) cheaply.
const setRemoteRef = (dir: string, remote: string, branch: string, sha: string): void => {
  runGitSync(dir, ["update-ref", `refs/remotes/${remote}/${branch}`, sha]);
};

const makeTempDir = (): string => fs.mkdtempSync(path.join(os.tmpdir(), "localterm-git-test-"));

describe("parseNumstatZ", () => {
  it("parses ordinary entries", () => {
    const raw = "3\t1\tsrc/app.ts\0" + "0\t5\tREADME.md\0";
    expect(parseNumstatZ(raw)).toEqual([
      { path: "src/app.ts", oldPath: null, additions: 3, deletions: 1, binary: false },
      { path: "README.md", oldPath: null, additions: 0, deletions: 5, binary: false },
    ]);
  });

  it("parses rename entries with old and new paths", () => {
    const raw = "2\t2\t\0old/name.ts\0new/name.ts\0";
    expect(parseNumstatZ(raw)).toEqual([
      { path: "new/name.ts", oldPath: "old/name.ts", additions: 2, deletions: 2, binary: false },
    ]);
  });

  it("marks binary entries", () => {
    const raw = "-\t-\timage.png\0";
    expect(parseNumstatZ(raw)).toEqual([
      { path: "image.png", oldPath: null, additions: 0, deletions: 0, binary: true },
    ]);
  });

  it("returns no entries for empty output", () => {
    expect(parseNumstatZ("")).toEqual([]);
  });
});

describe("parseNameStatusZ", () => {
  it("maps status letters", () => {
    const raw = "M\0changed.ts\0A\0new.ts\0D\0gone.ts\0";
    const statuses = parseNameStatusZ(raw);
    expect(statuses.get("changed.ts")).toBe("modified");
    expect(statuses.get("new.ts")).toBe("added");
    expect(statuses.get("gone.ts")).toBe("deleted");
  });

  it("maps rename entries to the new path", () => {
    const raw = "R100\0old.ts\0new.ts\0";
    expect(parseNameStatusZ(raw).get("new.ts")).toBe("renamed");
  });
});

describe("splitPatchByFile", () => {
  it("splits a multi-file patch into per-file chunks", () => {
    const patch = [
      "diff --git a/one.ts b/one.ts",
      "index 111..222 100644",
      "--- a/one.ts",
      "+++ b/one.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/two.ts b/two.ts",
      "index 333..444 100644",
      "--- a/two.ts",
      "+++ b/two.ts",
      "@@ -1 +1 @@",
      "-c",
      "+d",
      "",
    ].join("\n");
    const chunks = splitPatchByFile(patch);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain("a/one.ts");
    expect(chunks[0]).toContain("+b");
    expect(chunks[1]).toContain("a/two.ts");
    expect(chunks[1]).toContain("+d");
  });

  it("returns no chunks for empty output", () => {
    expect(splitPatchByFile("")).toEqual([]);
  });
});

describe("buildUntrackedPatch", () => {
  it("builds a single added hunk", () => {
    expect(buildUntrackedPatch("one\ntwo\n")).toBe("@@ -0,0 +1,2 @@\n+one\n+two\n");
  });

  it("marks a missing trailing newline", () => {
    expect(buildUntrackedPatch("one\ntwo")).toBe(
      "@@ -0,0 +1,2 @@\n+one\n+two\n\\ No newline at end of file\n",
    );
  });

  it("returns an empty patch for empty content", () => {
    expect(buildUntrackedPatch("")).toBe("");
  });
});

describe("getGitDiffSummary / getGitDiff", () => {
  let testRepo: TestRepo;
  let plainDir: string;

  beforeAll(async () => {
    plainDir = makeTempDir();

    testRepo = await initRepo(makeTempDir());
    fs.writeFileSync(path.join(testRepo.dir, "tracked.txt"), "alpha\nbeta\ngamma\n");
    fs.writeFileSync(path.join(testRepo.dir, "removed.txt"), "to be deleted\n");
    fs.writeFileSync(path.join(testRepo.dir, "renamed-old.txt"), "stable content\nlots of it\n");
    fs.writeFileSync(path.join(testRepo.dir, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    await commitAll(testRepo, "base");

    fs.writeFileSync(path.join(testRepo.dir, "tracked.txt"), "alpha\nBETA\ngamma\n");
    fs.rmSync(path.join(testRepo.dir, "removed.txt"));
    stageRename(testRepo, "renamed-old.txt", "renamed-new.txt");
    fs.writeFileSync(path.join(testRepo.dir, "binary.bin"), Buffer.from([0, 9, 9, 9, 0, 255]));
    fs.writeFileSync(path.join(testRepo.dir, "untracked.txt"), "new one\nnew two\n");
    fs.writeFileSync(path.join(testRepo.dir, "untracked.bin"), Buffer.from([0, 1, 2, 0]));
  });

  afterAll(() => {
    fs.rmSync(testRepo.dir, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
  });

  it("reports a non-repo directory", async () => {
    expect(await getGitDiffSummary(plainDir)).toEqual({
      isRepo: false,
      files: 0,
      additions: 0,
      deletions: 0,
      binaries: 0,
      branch: null,
    });
    expect(await getGitDiff(plainDir)).toEqual({ isRepo: false, files: [] });
  });

  it("summarizes tracked, untracked, and binary changes", async () => {
    const summary = await getGitDiffSummary(testRepo.dir);
    expect(summary.isRepo).toBe(true);
    expect(summary.files).toBe(6);
    expect(summary.additions).toBe(3);
    expect(summary.deletions).toBe(2);
    expect(summary.binaries).toBe(2);
    expect(summary.branch).toBe("main");
  });

  it("returns per-file entries with patches", async () => {
    const diff = await getGitDiff(testRepo.dir);
    expect(diff.isRepo).toBe(true);
    const byPath = new Map(diff.files.map((file) => [file.path, file]));

    const modified = byPath.get("tracked.txt");
    expect(modified?.status).toBe("modified");
    expect(modified?.additions).toBe(1);
    expect(modified?.deletions).toBe(1);
    expect(modified?.patch).toContain("-beta");
    expect(modified?.patch).toContain("+BETA");

    const deleted = byPath.get("removed.txt");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.deletions).toBe(1);

    const renamed = byPath.get("renamed-new.txt");
    expect(renamed?.status).toBe("renamed");
    expect(renamed?.oldPath).toBe("renamed-old.txt");

    const binary = byPath.get("binary.bin");
    expect(binary?.binary).toBe(true);
    expect(binary?.patch).toBeNull();
    expect(binary?.patchOmitted).toBe(false);

    const untracked = byPath.get("untracked.txt");
    expect(untracked?.status).toBe("untracked");
    expect(untracked?.additions).toBe(2);
    expect(untracked?.patch).toBe("@@ -0,0 +1,2 @@\n+new one\n+new two\n");

    const untrackedBinary = byPath.get("untracked.bin");
    expect(untrackedBinary?.status).toBe("untracked");
    expect(untrackedBinary?.binary).toBe(true);
    expect(untrackedBinary?.patch).toBeNull();
  });

  it("diffs against the empty tree in a repo with no commits", async () => {
    const freshRepo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(freshRepo.dir, "staged.txt"), "first\nsecond\n");
      stagePath(freshRepo, "staged.txt");

      const summary = await getGitDiffSummary(freshRepo.dir);
      expect(summary.isRepo).toBe(true);
      expect(summary.files).toBe(1);
      expect(summary.additions).toBe(2);

      const diff = await getGitDiff(freshRepo.dir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0].status).toBe("added");
      expect(diff.files[0].patch).toContain("+first");
    } finally {
      fs.rmSync(freshRepo.dir, { recursive: true, force: true });
    }
  });

  it("reports a clean repo as zero changes", async () => {
    const cleanRepo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(cleanRepo.dir, "file.txt"), "content\n");
      await commitAll(cleanRepo, "base");
      const summary = await getGitDiffSummary(cleanRepo.dir);
      expect(summary).toEqual({
        isRepo: true,
        files: 0,
        additions: 0,
        deletions: 0,
        binaries: 0,
        branch: "main",
      });
      expect((await getGitDiff(cleanRepo.dir)).files).toEqual([]);
    } finally {
      fs.rmSync(cleanRepo.dir, { recursive: true, force: true });
    }
  });
});

describe("getGitDiffFiles / getGitDiffFilePatch", () => {
  let testRepo: TestRepo;
  let plainDir: string;

  beforeAll(async () => {
    plainDir = makeTempDir();

    testRepo = await initRepo(makeTempDir());
    fs.writeFileSync(path.join(testRepo.dir, "tracked.txt"), "alpha\nbeta\ngamma\n");
    fs.writeFileSync(path.join(testRepo.dir, "removed.txt"), "to be deleted\n");
    fs.writeFileSync(
      path.join(testRepo.dir, "renamed-old.txt"),
      "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
    );
    fs.writeFileSync(path.join(testRepo.dir, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    fs.mkdirSync(path.join(testRepo.dir, "dir with space"));
    fs.writeFileSync(path.join(testRepo.dir, "dir with space", "café.ts"), "const a = 1;\n");
    fs.writeFileSync(path.join(testRepo.dir, "huge.txt"), "seed\n");
    await commitAll(testRepo, "base");

    fs.writeFileSync(path.join(testRepo.dir, "tracked.txt"), "alpha\nBETA\ngamma\n");
    fs.rmSync(path.join(testRepo.dir, "removed.txt"));
    stageRename(testRepo, "renamed-old.txt", "renamed-new.txt");
    fs.writeFileSync(
      path.join(testRepo.dir, "renamed-new.txt"),
      "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\n",
    );
    fs.writeFileSync(path.join(testRepo.dir, "binary.bin"), Buffer.from([0, 9, 9, 9, 0, 255]));
    fs.writeFileSync(path.join(testRepo.dir, "dir with space", "café.ts"), "const a = 2;\n");
    fs.writeFileSync(path.join(testRepo.dir, "huge.txt"), `${"x".repeat(1024)}\n`.repeat(1500));
    fs.writeFileSync(path.join(testRepo.dir, "untracked.txt"), "new one\nnew two\n");
    fs.writeFileSync(path.join(testRepo.dir, "untracked.bin"), Buffer.from([0, 1, 2, 0]));
  });

  afterAll(() => {
    fs.rmSync(testRepo.dir, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
  });

  it("lists per-file metadata without patch bodies", async () => {
    expect(await getGitDiffFiles(plainDir)).toEqual({ isRepo: false, files: [] });

    const list = await getGitDiffFiles(testRepo.dir);
    expect(list.isRepo).toBe(true);
    for (const file of list.files) {
      expect(file).not.toHaveProperty("patch");
      expect(file).not.toHaveProperty("patchOmitted");
    }
    const byPath = new Map(list.files.map((file) => [file.path, file]));
    expect(byPath.get("tracked.txt")).toMatchObject({
      status: "modified",
      additions: 1,
      deletions: 1,
      binary: false,
    });
    expect(byPath.get("removed.txt")?.status).toBe("deleted");
    expect(byPath.get("renamed-new.txt")).toMatchObject({
      status: "renamed",
      oldPath: "renamed-old.txt",
    });
    expect(byPath.get("binary.bin")?.binary).toBe(true);
    expect(byPath.get("untracked.txt")?.status).toBe("untracked");
    expect(byPath.get("untracked.bin")).toMatchObject({ status: "untracked", binary: true });
  });

  it("returns a modified file's patch", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "tracked.txt");
    expect(result.binary).toBe(false);
    expect(result.patchOmitted).toBe(false);
    expect(result.patch).toContain("-beta");
    expect(result.patch).toContain("+BETA");
  });

  it("returns a single rename chunk for a renamed file", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "renamed-new.txt");
    expect(result.binary).toBe(false);
    expect(result.patchOmitted).toBe(false);
    expect(splitPatchByFile(result.patch ?? "")).toHaveLength(1);
    expect(result.patch).toContain("rename from renamed-old.txt");
    expect(result.patch).toContain("rename to renamed-new.txt");
    expect(result.patch).toContain("-two");
    expect(result.patch).toContain("+TWO");
  });

  it("returns a deleted file's patch", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "removed.txt");
    expect(result.patch).toContain("deleted file mode");
    expect(result.patch).toContain("-to be deleted");
  });

  it("reports a binary file with no patch", async () => {
    expect(await getGitDiffFilePatch(testRepo.dir, "binary.bin")).toEqual({
      patch: null,
      patchOmitted: false,
      binary: true,
    });
  });

  it("synthesizes a patch for an untracked text file", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "untracked.txt");
    expect(result.patch).toBe("@@ -0,0 +1,2 @@\n+new one\n+new two\n");
    expect(result.binary).toBe(false);
  });

  it("reports an untracked binary file", async () => {
    expect(await getGitDiffFilePatch(testRepo.dir, "untracked.bin")).toMatchObject({
      patch: null,
      binary: true,
    });
  });

  it("handles paths with spaces and unicode", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "dir with space/café.ts");
    expect(result.patch).toContain("-const a = 1;");
    expect(result.patch).toContain("+const a = 2;");
  });

  it("omits a patch that exceeds the per-file size cap", async () => {
    expect(await getGitDiffFilePatch(testRepo.dir, "huge.txt")).toEqual({
      patch: null,
      patchOmitted: true,
      binary: false,
    });
  });

  it("returns an empty result for an unknown path", async () => {
    expect(await getGitDiffFilePatch(testRepo.dir, "does-not-exist.txt")).toEqual({
      patch: null,
      patchOmitted: false,
      binary: false,
    });
  });
});

describe("branch comparison mode", () => {
  let testRepo: TestRepo;

  beforeAll(async () => {
    testRepo = await initRepo(makeTempDir());
    fs.writeFileSync(path.join(testRepo.dir, "app.ts"), "1\n");
    fs.writeFileSync(path.join(testRepo.dir, "shared.ts"), "x\n");
    await commitAll(testRepo, "base");

    createAndCheckoutBranch(testRepo, "feature");
    fs.writeFileSync(path.join(testRepo.dir, "app.ts"), "1\n2\n");
    await commitAll(testRepo, "feature work");

    checkoutBranch(testRepo, "main");
    fs.writeFileSync(path.join(testRepo.dir, "shared.ts"), "x\ny\n");
    await commitAll(testRepo, "main advance");

    checkoutBranch(testRepo, "feature");
    fs.writeFileSync(path.join(testRepo.dir, "app.ts"), "1\n2\n3\n");
    fs.writeFileSync(path.join(testRepo.dir, "new.ts"), "brand new\n");
  });

  afterAll(() => {
    fs.rmSync(testRepo.dir, { recursive: true, force: true });
  });

  it("compares the working tree to the merge base, not the base tip", async () => {
    const list = await getGitDiffFiles(testRepo.dir, { mode: "branch", base: "main" });
    const byPath = new Map(list.files.map((file) => [file.path, file]));

    expect(byPath.get("app.ts")).toMatchObject({ status: "modified", additions: 2, deletions: 0 });
    expect(byPath.get("new.ts")?.status).toBe("untracked");
    expect(byPath.has("shared.ts")).toBe(false);
  });

  it("working mode shows only uncommitted changes, not the whole branch", async () => {
    const list = await getGitDiffFiles(testRepo.dir, { mode: "working" });
    const byPath = new Map(list.files.map((file) => [file.path, file]));
    expect(byPath.get("app.ts")).toMatchObject({ status: "modified", additions: 1 });
    expect(byPath.get("new.ts")?.status).toBe("untracked");
  });

  it("resolves a default base branch when none is given", async () => {
    const auto = await getGitDiffFiles(testRepo.dir, { mode: "branch" });
    const explicit = await getGitDiffFiles(testRepo.dir, { mode: "branch", base: "main" });
    expect(auto.files.map((file) => file.path).sort()).toEqual(
      explicit.files.map((file) => file.path).sort(),
    );
  });

  it("returns a branch-mode patch spanning committed and uncommitted lines", async () => {
    const result = await getGitDiffFilePatch(testRepo.dir, "app.ts", {
      mode: "branch",
      base: "main",
    });
    expect(result.patchOmitted).toBe(false);
    expect(result.patch).toContain("+2");
    expect(result.patch).toContain("+3");
  });

  it("reports branch info with a fallback default base", async () => {
    const info = await getGitBranchInfo(testRepo.dir);
    expect(info.isRepo).toBe(true);
    expect(info.currentBranch).toBe("feature");
    expect(info.branches).toContain("main");
    expect(info.branches).toContain("feature");
    expect(info.defaultBase).toBe("main");
    expect(info.defaultBaseSource).toBe("fallback");
    expect(info.pr).toBeNull();
  });

  it("collects GitHub slugs from both fork and upstream remotes", async () => {
    const forkRepo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(forkRepo.dir, "file.txt"), "content\n");
      await commitAll(forkRepo, "initial");
      addRemote(forkRepo, "origin", "git@github.com:me/fork.git");
      addRemote(forkRepo, "upstream", "https://github.com/them/repo.git");
      addRemote(forkRepo, "mirror", "https://gitlab.com/me/fork.git");
      const slugs = await listGithubRemoteSlugs(forkRepo.dir);
      expect(slugs).toContain("me/fork");
      expect(slugs).toContain("them/repo");
      expect(slugs).not.toContain("me/fork.git");
      expect(slugs.some((slug) => slug.includes("gitlab"))).toBe(false);
    } finally {
      fs.rmSync(forkRepo.dir, { recursive: true, force: true });
    }
  });

  it("returns PR data without internal headOwner field", async () => {
    const forkRepo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(forkRepo.dir, "file.txt"), "content\n");
      await commitAll(forkRepo, "initial");
      const baseSha = getHeadSha(forkRepo.dir);
      createAndCheckoutBranch(forkRepo, "feature");
      addRemote(forkRepo, "origin", "git@github.com:me/fork.git");
      addRemote(forkRepo, "upstream", "https://github.com/them/repo.git");
      // Plant upstream/main locally so detectPr resolves baseRef without a
      // network fetch against the fake remote URL, and so the assertion can
      // validate the resolved base.
      setRemoteRef(forkRepo.dir, "upstream", "main", baseSha);

      setPrFetcher({
        list: async (slug, head, _state, _perPage) => {
          if (slug === "them/repo" && head === "me:feature") {
            return [
              {
                number: 42,
                title: "Test PR",
                baseRefName: "main",
                url: "https://github.com/them/repo/pull/42",
                state: "open" as const,
                isDraft: false,
                mergeable: "mergeable" as const,
                headOwner: "me",
                baseRepoFullName: "them/repo",
              },
            ];
          }
          return [];
        },
      });
      try {
        const info = await getGitBranchInfo(forkRepo.dir);
        expect(info.pr).toBeNull();
        const detected = await getGitBranchPr(forkRepo.dir);
        expect(detected).not.toBeNull();
        expect(detected).toEqual({
          number: 42,
          title: "Test PR",
          baseRefName: "main",
          baseRef: "upstream/main",
          url: "https://github.com/them/repo/pull/42",
          state: "open",
          isDraft: false,
          mergeable: "mergeable",
        });
        expect(detected).not.toHaveProperty("headOwner");
        expect(detected).not.toHaveProperty("baseRepoFullName");
      } finally {
        setPrFetcher({
          list: async () => [],
        });
      }
    } finally {
      fs.rmSync(forkRepo.dir, { recursive: true, force: true });
    }
  });

  it("reports a non-repo directory for branch info", async () => {
    const plainDir = makeTempDir();
    try {
      expect(await getGitBranchInfo(plainDir)).toEqual({
        isRepo: false,
        currentBranch: null,
        defaultBase: null,
        defaultBaseSource: null,
        branches: [],
        pr: null,
      });
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

describe("fork PR base resolution", () => {
  // A fork PR targets the upstream repo's default branch, not the fork's own.
  // The diff must therefore compare against upstream/<base>, otherwise commits
  // that exist only on the fork's drifted default branch appear in (or vanish
  // from) the PR diff and disagree with GitHub's Files changed.
  //
  // Fixture: base B0 (a.txt). origin/main advances with a drift commit D that
  // adds drift.txt. feature branches off D (so it contains the drift) and adds
  // feature.txt. upstream/main is planted at B0 (no drift). The PR base is
  // them/repo:main -> upstream/main (B0). Diffing against upstream/main shows
  // drift.txt (B0 lacked it); diffing against origin/main (D) would hide it.
  let forkRepo: TestRepo;
  let baseSha: string;
  let driftSha: string;

  beforeAll(async () => {
    forkRepo = await initRepo(makeTempDir());
    fs.writeFileSync(path.join(forkRepo.dir, "a.txt"), "a\n");
    await commitAll(forkRepo, "base");
    baseSha = getHeadSha(forkRepo.dir);

    fs.writeFileSync(path.join(forkRepo.dir, "drift.txt"), "drift\n");
    await commitAll(forkRepo, "drift");
    driftSha = getHeadSha(forkRepo.dir);

    createAndCheckoutBranch(forkRepo, "feature");
    fs.writeFileSync(path.join(forkRepo.dir, "feature.txt"), "feature\n");
    await commitAll(forkRepo, "feature work");

    addRemote(forkRepo, "origin", "git@github.com:me/fork.git");
    addRemote(forkRepo, "upstream", "https://github.com/them/repo.git");
    setRemoteRef(forkRepo.dir, "origin", "main", driftSha);
    setRemoteRef(forkRepo.dir, "upstream", "main", baseSha);

    setPrFetcher({
      list: async (slug, head, _state, _perPage) => {
        if (slug === "them/repo" && head === "me:feature") {
          return [
            {
              number: 7,
              title: "Fork PR",
              baseRefName: "main",
              url: "https://github.com/them/repo/pull/7",
              state: "open" as const,
              isDraft: false,
              mergeable: "mergeable" as const,
              headOwner: "me",
              baseRepoFullName: "them/repo",
            },
          ];
        }
        return [];
      },
    });
  });

  afterAll(() => {
    fs.rmSync(forkRepo.dir, { recursive: true, force: true });
    setPrFetcher({ list: async () => [] });
  });

  it("compares a fork PR branch against upstream, not origin", async () => {
    // Warm the per-(cwd, branch) PR cache the way the client does (it fires
    // getGitBranchPr in parallel, then opens branch mode once pr resolves).
    const pr = await getGitBranchPr(forkRepo.dir);
    expect(pr).not.toBeNull();
    expect(pr?.baseRefName).toBe("main");

    const list = await getGitDiffFiles(forkRepo.dir, { mode: "branch" });
    const paths = new Set(list.files.map((file) => file.path));
    // drift.txt proves the base resolved to upstream/main (B0 lacked it); origin
    // (driftSha) already has it, so it would be absent from an origin-based diff.
    expect(paths.has("drift.txt")).toBe(true);
    expect(paths.has("feature.txt")).toBe(true);
    expect(paths.has("a.txt")).toBe(false);
  });

  it("does not regress when no PR is detected (falls back to repo default)", async () => {
    setPrFetcher({ list: async () => [] });
    const freshRepo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(freshRepo.dir, "a.txt"), "a\n");
      await commitAll(freshRepo, "base");
      const baseSha = getHeadSha(freshRepo.dir);
      addRemote(freshRepo, "origin", "git@github.com:me/repo.git");
      setRemoteRef(freshRepo.dir, "origin", "main", baseSha);
      createAndCheckoutBranch(freshRepo, "feature");
      fs.writeFileSync(path.join(freshRepo.dir, "b.txt"), "b\n");
      await commitAll(freshRepo, "work");
      // No PR cache (getGitBranchPr returns null) -> resolveDefaultBase kicks in.
      expect(await getGitBranchPr(freshRepo.dir)).toBeNull();
      const list = await getGitDiffFiles(freshRepo.dir, { mode: "branch" });
      expect(new Set(list.files.map((file) => file.path)).has("b.txt")).toBe(true);
    } finally {
      fs.rmSync(freshRepo.dir, { recursive: true, force: true });
    }
  });

  it("resolves a same-repo PR base to the same remote (origin), not upstream", async () => {
    // A PR whose base repo IS the origin repo (a normal, non-fork PR) must keep
    // the comparison on origin — only fork PRs reroute to upstream. The picker
    // and diff would otherwise jump a same-repo PR onto an unrelated upstream ref.
    const repo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      const baseSha = getHeadSha(repo.dir);
      createAndCheckoutBranch(repo, "feature");
      fs.writeFileSync(path.join(repo.dir, "feature.txt"), "f\n");
      await commitAll(repo, "feature work");
      // origin is the same repo the PR targets; an `upstream` remote is also
      // configured (mimicking a repo that happens to have upstream too) to prove
      // the same-repo PR does NOT reroute to it.
      addRemote(repo, "origin", "git@github.com:me/repo.git");
      addRemote(repo, "upstream", "https://github.com/them/parent.git");
      setRemoteRef(repo.dir, "origin", "main", baseSha);
      setRemoteRef(repo.dir, "upstream", "main", getHeadSha(repo.dir));
      // baseRepoFullName matches origin's slug -> same-repo PR.
      setPrFetcher({
        list: async (slug, head) =>
          slug === "me/repo" && head === "me:feature"
            ? [
                {
                  number: 11,
                  title: "Same-repo PR",
                  baseRefName: "main",
                  url: "https://github.com/me/repo/pull/11",
                  state: "open" as const,
                  isDraft: false,
                  mergeable: "mergeable" as const,
                  headOwner: "me",
                  baseRepoFullName: "me/repo",
                },
              ]
            : [],
      });
      const detected = await getGitBranchPr(repo.dir);
      expect(detected).not.toBeNull();
      // baseRef stays on origin (the same remote), not upstream.
      expect(detected?.baseRef).toBe("origin/main");
      const paths = new Set(
        (await getGitDiffFiles(repo.dir, { mode: "branch" })).files.map((file) => file.path),
      );
      expect(paths.has("feature.txt")).toBe(true);
      // feature branched off base (a.txt only), so a.txt is not a change.
      expect(paths.has("a.txt")).toBe(false);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("matches the upstream remote case-insensitively", async () => {
    // GitHub repo names are case-insensitive; a remote URL stored with different
    // casing than the API's canonical full_name must still match, else a fork PR
    // would miss its upstream remote and silently fall back to origin.
    const repo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      const baseRefSha = getHeadSha(repo.dir);
      fs.writeFileSync(path.join(repo.dir, "drift.txt"), "drift\n");
      await commitAll(repo, "drift");
      const driftSha = getHeadSha(repo.dir);
      createAndCheckoutBranch(repo, "feature");
      fs.writeFileSync(path.join(repo.dir, "feature.txt"), "feature\n");
      await commitAll(repo, "feature work");
      addRemote(repo, "origin", "git@github.com:me/fork.git");
      // upstream URL uses uppercase owner/repo; the PR's baseRepoFullName is the
      // lowercase canonical form.
      addRemote(repo, "upstream", "https://github.com/Them/Repo.git");
      setRemoteRef(repo.dir, "origin", "main", driftSha);
      setRemoteRef(repo.dir, "upstream", "main", baseRefSha);
      setPrFetcher({
        list: async (slug, head) =>
          slug.toLowerCase() === "them/repo" && head === "me:feature"
            ? [
                {
                  number: 9,
                  title: "PR",
                  baseRefName: "main",
                  url: "https://github.com/them/repo/pull/9",
                  state: "open" as const,
                  isDraft: false,
                  mergeable: "mergeable" as const,
                  headOwner: "me",
                  baseRepoFullName: "them/repo",
                },
              ]
            : [],
      });
      expect(await getGitBranchPr(repo.dir)).not.toBeNull();
      const paths = new Set(
        (await getGitDiffFiles(repo.dir, { mode: "branch" })).files.map((file) => file.path),
      );
      expect(paths.has("drift.txt")).toBe(true);
      expect(paths.has("feature.txt")).toBe(true);
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });

  it("resolves the upstream base on a cold PR cache (branch mode opened before the PR fetch landed)", async () => {
    // The client normally gates branch mode on branchInfo.pr, which warms the
    // server cache via getGitBranchPr. But a user can pick branch mode (or hit
    // refresh) before that lands — a cold cache must resolve the PR inline instead
    // of silently falling back to the fork's own drifted default.
    const repo = await initRepo(makeTempDir());
    try {
      fs.writeFileSync(path.join(repo.dir, "a.txt"), "a\n");
      await commitAll(repo, "base");
      const baseRefSha = getHeadSha(repo.dir);
      fs.writeFileSync(path.join(repo.dir, "drift.txt"), "drift\n");
      await commitAll(repo, "drift");
      const driftSha = getHeadSha(repo.dir);
      createAndCheckoutBranch(repo, "feature");
      fs.writeFileSync(path.join(repo.dir, "feature.txt"), "feature\n");
      await commitAll(repo, "feature work");
      addRemote(repo, "origin", "git@github.com:me/fork.git");
      addRemote(repo, "upstream", "https://github.com/them/repo.git");
      setRemoteRef(repo.dir, "origin", "main", driftSha);
      setRemoteRef(repo.dir, "upstream", "main", baseRefSha);
      setPrFetcher({
        list: async (slug, head) =>
          slug === "them/repo" && head === "me:feature"
            ? [
                {
                  number: 10,
                  title: "PR",
                  baseRefName: "main",
                  url: "https://github.com/them/repo/pull/10",
                  state: "open" as const,
                  isDraft: false,
                  mergeable: "mergeable" as const,
                  headOwner: "me",
                  baseRepoFullName: "them/repo",
                },
              ]
            : [],
      });
      // Deliberately not pre-warming via getGitBranchPr — the cache is cold.
      const paths = new Set(
        (await getGitDiffFiles(repo.dir, { mode: "branch" })).files.map((file) => file.path),
      );
      expect(paths.has("drift.txt")).toBe(true);
      expect(paths.has("feature.txt")).toBe(true);
      // And the inline resolution populated the cache for the next open.
      expect(await getGitBranchPr(repo.dir)).not.toBeNull();
    } finally {
      fs.rmSync(repo.dir, { recursive: true, force: true });
    }
  });
});
