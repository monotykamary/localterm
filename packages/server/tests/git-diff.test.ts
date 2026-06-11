import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  buildUntrackedPatch,
  getGitDiff,
  getGitDiffSummary,
  parseNameStatusZ,
  parseNumstatZ,
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
      });
      expect((await getGitDiff(cleanDir)).files).toEqual([]);
    } finally {
      fs.rmSync(cleanDir, { recursive: true, force: true });
    }
  });
});
