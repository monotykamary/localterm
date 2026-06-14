import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  buildUntrackedPatch,
  getGitBranchInfo,
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

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

const commitAll = (cwd: string, message: string): void => {
  git(cwd, "add", "--all");
  git(
    cwd,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--no-gpg-sign",
    "-m",
    message,
  );
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
  let repoDir: string;
  let plainDir: string;

  beforeAll(() => {
    plainDir = makeTempDir();

    repoDir = makeTempDir();
    git(repoDir, "init", "--initial-branch=main");
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "alpha\nbeta\ngamma\n");
    fs.writeFileSync(path.join(repoDir, "removed.txt"), "to be deleted\n");
    fs.writeFileSync(path.join(repoDir, "renamed-old.txt"), "stable content\nlots of it\n");
    fs.writeFileSync(path.join(repoDir, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    commitAll(repoDir, "base");

    // modified: 1 addition, 1 deletion
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "alpha\nBETA\ngamma\n");
    // deleted
    fs.rmSync(path.join(repoDir, "removed.txt"));
    // renamed without content change — staged via `git mv`; an unstaged
    // filesystem rename is correctly reported as deleted + untracked instead
    git(repoDir, "mv", "renamed-old.txt", "renamed-new.txt");
    // binary modified
    fs.writeFileSync(path.join(repoDir, "binary.bin"), Buffer.from([0, 9, 9, 9, 0, 255]));
    // untracked text: 2 additions
    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "new one\nnew two\n");
    // untracked binary
    fs.writeFileSync(path.join(repoDir, "untracked.bin"), Buffer.from([0, 1, 2, 0]));
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
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
    const summary = await getGitDiffSummary(repoDir);
    expect(summary.isRepo).toBe(true);
    // tracked.txt (M), removed.txt (D), renamed (R), binary.bin (M),
    // untracked.txt, untracked.bin
    expect(summary.files).toBe(6);
    // 1 (tracked.txt) + 2 (untracked.txt)
    expect(summary.additions).toBe(3);
    // 1 (tracked.txt) + 1 (removed.txt)
    expect(summary.deletions).toBe(2);
    // binary.bin + untracked.bin
    expect(summary.binaries).toBe(2);
    // current branch surfaced for the ambient PR-lease refresh
    expect(summary.branch).toBe("main");
  });

  it("returns per-file entries with patches", async () => {
    const diff = await getGitDiff(repoDir);
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
    const freshDir = makeTempDir();
    try {
      git(freshDir, "init", "--initial-branch=main");
      fs.writeFileSync(path.join(freshDir, "staged.txt"), "first\nsecond\n");
      git(freshDir, "add", "staged.txt");

      const summary = await getGitDiffSummary(freshDir);
      expect(summary.isRepo).toBe(true);
      expect(summary.files).toBe(1);
      expect(summary.additions).toBe(2);

      const diff = await getGitDiff(freshDir);
      expect(diff.files).toHaveLength(1);
      expect(diff.files[0].status).toBe("added");
      expect(diff.files[0].patch).toContain("+first");
    } finally {
      fs.rmSync(freshDir, { recursive: true, force: true });
    }
  });

  it("reports a clean repo as zero changes", async () => {
    const cleanDir = makeTempDir();
    try {
      git(cleanDir, "init", "--initial-branch=main");
      fs.writeFileSync(path.join(cleanDir, "file.txt"), "content\n");
      commitAll(cleanDir, "base");
      const summary = await getGitDiffSummary(cleanDir);
      expect(summary).toEqual({
        isRepo: true,
        files: 0,
        additions: 0,
        deletions: 0,
        binaries: 0,
        branch: "main",
      });
      expect((await getGitDiff(cleanDir)).files).toEqual([]);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });
});

describe("getGitDiffFiles / getGitDiffFilePatch", () => {
  let repoDir: string;
  let plainDir: string;

  beforeAll(() => {
    plainDir = makeTempDir();

    repoDir = makeTempDir();
    git(repoDir, "init", "--initial-branch=main");
    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "alpha\nbeta\ngamma\n");
    fs.writeFileSync(path.join(repoDir, "removed.txt"), "to be deleted\n");
    // A rename that keeps >50% similarity so `git diff -M` pairs old->new into a
    // single rename chunk rather than a delete + add.
    fs.writeFileSync(
      path.join(repoDir, "renamed-old.txt"),
      "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n",
    );
    fs.writeFileSync(path.join(repoDir, "binary.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
    fs.mkdirSync(path.join(repoDir, "dir with space"));
    fs.writeFileSync(path.join(repoDir, "dir with space", "café.ts"), "const a = 1;\n");
    fs.writeFileSync(path.join(repoDir, "huge.txt"), "seed\n");
    commitAll(repoDir, "base");

    fs.writeFileSync(path.join(repoDir, "tracked.txt"), "alpha\nBETA\ngamma\n");
    fs.rmSync(path.join(repoDir, "removed.txt"));
    git(repoDir, "mv", "renamed-old.txt", "renamed-new.txt");
    fs.writeFileSync(
      path.join(repoDir, "renamed-new.txt"),
      "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\n",
    );
    fs.writeFileSync(path.join(repoDir, "binary.bin"), Buffer.from([0, 9, 9, 9, 0, 255]));
    fs.writeFileSync(path.join(repoDir, "dir with space", "café.ts"), "const a = 2;\n");
    // Patch will exceed the 1 MB per-file cap → patchOmitted.
    fs.writeFileSync(path.join(repoDir, "huge.txt"), `${"x".repeat(1024)}\n`.repeat(1500));
    fs.writeFileSync(path.join(repoDir, "untracked.txt"), "new one\nnew two\n");
    fs.writeFileSync(path.join(repoDir, "untracked.bin"), Buffer.from([0, 1, 2, 0]));
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.rmSync(plainDir, { recursive: true, force: true });
  });

  it("lists per-file metadata without patch bodies", async () => {
    expect(await getGitDiffFiles(plainDir)).toEqual({ isRepo: false, files: [] });

    const list = await getGitDiffFiles(repoDir);
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
    const result = await getGitDiffFilePatch(repoDir, "tracked.txt");
    expect(result.binary).toBe(false);
    expect(result.patchOmitted).toBe(false);
    expect(result.patch).toContain("-beta");
    expect(result.patch).toContain("+BETA");
  });

  it("returns a single rename chunk for a renamed file", async () => {
    const result = await getGitDiffFilePatch(repoDir, "renamed-new.txt");
    expect(result.binary).toBe(false);
    expect(result.patchOmitted).toBe(false);
    // Both endpoints diffed together → one rename chunk (not an add + delete).
    expect(splitPatchByFile(result.patch ?? "")).toHaveLength(1);
    expect(result.patch).toContain("rename from renamed-old.txt");
    expect(result.patch).toContain("rename to renamed-new.txt");
    expect(result.patch).toContain("-two");
    expect(result.patch).toContain("+TWO");
  });

  it("returns a deleted file's patch", async () => {
    const result = await getGitDiffFilePatch(repoDir, "removed.txt");
    expect(result.patch).toContain("deleted file mode");
    expect(result.patch).toContain("-to be deleted");
  });

  it("reports a binary file with no patch", async () => {
    expect(await getGitDiffFilePatch(repoDir, "binary.bin")).toEqual({
      patch: null,
      patchOmitted: false,
      binary: true,
    });
  });

  it("synthesizes a patch for an untracked text file", async () => {
    const result = await getGitDiffFilePatch(repoDir, "untracked.txt");
    expect(result.patch).toBe("@@ -0,0 +1,2 @@\n+new one\n+new two\n");
    expect(result.binary).toBe(false);
  });

  it("reports an untracked binary file", async () => {
    expect(await getGitDiffFilePatch(repoDir, "untracked.bin")).toMatchObject({
      patch: null,
      binary: true,
    });
  });

  it("handles paths with spaces and unicode", async () => {
    const result = await getGitDiffFilePatch(repoDir, "dir with space/café.ts");
    expect(result.patch).toContain("-const a = 1;");
    expect(result.patch).toContain("+const a = 2;");
  });

  it("omits a patch that exceeds the per-file size cap", async () => {
    expect(await getGitDiffFilePatch(repoDir, "huge.txt")).toEqual({
      patch: null,
      patchOmitted: true,
      binary: false,
    });
  });

  it("returns an empty result for an unknown path", async () => {
    expect(await getGitDiffFilePatch(repoDir, "does-not-exist.txt")).toEqual({
      patch: null,
      patchOmitted: false,
      binary: false,
    });
  });
});

describe("branch comparison mode", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = makeTempDir();
    git(repoDir, "init", "--initial-branch=main");
    fs.writeFileSync(path.join(repoDir, "app.ts"), "1\n");
    fs.writeFileSync(path.join(repoDir, "shared.ts"), "x\n");
    commitAll(repoDir, "base");

    // Feature branch: a committed change to app.ts.
    git(repoDir, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(repoDir, "app.ts"), "1\n2\n");
    commitAll(repoDir, "feature work");

    // main advances independently AFTER the fork — this change must NOT show up
    // in the feature branch's merge-base diff.
    git(repoDir, "checkout", "main");
    fs.writeFileSync(path.join(repoDir, "shared.ts"), "x\ny\n");
    commitAll(repoDir, "main advance");

    git(repoDir, "checkout", "feature");
    // Uncommitted work + an untracked file on top of the feature commit.
    fs.writeFileSync(path.join(repoDir, "app.ts"), "1\n2\n3\n");
    fs.writeFileSync(path.join(repoDir, "new.ts"), "brand new\n");
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("compares the working tree to the merge base, not the base tip", async () => {
    const list = await getGitDiffFiles(repoDir, { mode: "branch", base: "main" });
    const byPath = new Map(list.files.map((file) => [file.path, file]));

    // Committed-on-feature + uncommitted change, measured from the merge base.
    expect(byPath.get("app.ts")).toMatchObject({ status: "modified", additions: 2, deletions: 0 });
    // Untracked work on top is part of "current state".
    expect(byPath.get("new.ts")?.status).toBe("untracked");
    // shared.ts only changed on main after the fork — excluded by merge-base.
    expect(byPath.has("shared.ts")).toBe(false);
  });

  it("working mode shows only uncommitted changes, not the whole branch", async () => {
    const list = await getGitDiffFiles(repoDir, { mode: "working" });
    const byPath = new Map(list.files.map((file) => [file.path, file]));
    // Working tree vs HEAD (feature tip): only the last, uncommitted +3 line.
    expect(byPath.get("app.ts")).toMatchObject({ status: "modified", additions: 1 });
    expect(byPath.get("new.ts")?.status).toBe("untracked");
  });

  it("resolves a default base branch when none is given", async () => {
    // No remote/PR here, so default falls back to the conventional main branch.
    const auto = await getGitDiffFiles(repoDir, { mode: "branch" });
    const explicit = await getGitDiffFiles(repoDir, { mode: "branch", base: "main" });
    expect(auto.files.map((file) => file.path).sort()).toEqual(
      explicit.files.map((file) => file.path).sort(),
    );
  });

  it("returns a branch-mode patch spanning committed and uncommitted lines", async () => {
    const result = await getGitDiffFilePatch(repoDir, "app.ts", { mode: "branch", base: "main" });
    expect(result.patchOmitted).toBe(false);
    expect(result.patch).toContain("+2");
    expect(result.patch).toContain("+3");
  });

  it("reports branch info with a fallback default base", async () => {
    const info = await getGitBranchInfo(repoDir);
    expect(info.isRepo).toBe(true);
    expect(info.currentBranch).toBe("feature");
    expect(info.branches).toContain("main");
    expect(info.branches).toContain("feature");
    expect(info.defaultBase).toBe("main");
    expect(info.defaultBaseSource).toBe("fallback");
    // No GitHub remote/PR in a bare temp repo.
    expect(info.pr).toBeNull();
  });

  it("collects GitHub slugs from both fork and upstream remotes", async () => {
    const forkDir = makeTempDir();
    try {
      git(forkDir, "init", "--initial-branch=main");
      // Fork over SSH, upstream over HTTPS, plus a non-GitHub remote to ignore.
      git(forkDir, "remote", "add", "origin", "git@github.com:me/fork.git");
      git(forkDir, "remote", "add", "upstream", "https://github.com/them/repo.git");
      git(forkDir, "remote", "add", "mirror", "https://gitlab.com/me/fork.git");
      const slugs = await listGithubRemoteSlugs(forkDir);
      expect(slugs).toContain("me/fork");
      expect(slugs).toContain("them/repo");
      expect(slugs).not.toContain("me/fork.git");
      expect(slugs.some((slug) => slug.includes("gitlab"))).toBe(false);
    } finally {
      fs.rmSync(forkDir, { recursive: true, force: true });
    }
  });

  it("returns PR data without internal headOwner field", async () => {
    const forkDir = makeTempDir();
    try {
      git(forkDir, "init", "--initial-branch=main");
      fs.writeFileSync(path.join(forkDir, "file.txt"), "content\n");
      commitAll(forkDir, "initial");
      git(forkDir, "checkout", "-b", "feature");
      git(forkDir, "remote", "add", "origin", "git@github.com:me/fork.git");
      git(forkDir, "remote", "add", "upstream", "https://github.com/them/repo.git");

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
                headOwner: "me",
              },
            ];
          }
          return [];
        },
      });
      try {
        const info = await getGitBranchInfo(forkDir);
        expect(info.pr).not.toBeNull();
        expect(info.pr).toEqual({
          number: 42,
          title: "Test PR",
          baseRefName: "main",
          url: "https://github.com/them/repo/pull/42",
          state: "open",
        });
        // Regression: headOwner must not leak into the public shape.
        expect(info.pr).not.toHaveProperty("headOwner");
      } finally {
        setPrFetcher({
          list: async () => [],
        });
      }
    } finally {
      fs.rmSync(forkDir, { recursive: true, force: true });
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
