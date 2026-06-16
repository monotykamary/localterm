import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { buildGitSnapshot, classifyGitChanges, type GitSnapshot } from "../src/git-diff-watcher.js";

const sha = (index: number): string => String(index).padStart(40, "0");

const createRepo = (root: string): void => {
  const gitDir = path.join(root, ".git");
  fs.mkdirSync(path.join(gitDir, "refs", "heads"), { recursive: true });
  fs.mkdirSync(path.join(gitDir, "refs", "tags"), { recursive: true });
  fs.mkdirSync(path.join(gitDir, "refs", "remotes", "origin"), { recursive: true });
  fs.writeFileSync(path.join(gitDir, "HEAD"), "ref: refs/heads/main\n");
  fs.writeFileSync(path.join(gitDir, "refs", "heads", "main"), `${sha(1)}\n`);
};

const addRef = (snapshot: GitSnapshot, name: string, value: string): GitSnapshot => ({
  ...snapshot,
  refs: new Map([...snapshot.refs, [name, value]]),
});

const setHead = (snapshot: GitSnapshot, value: string): GitSnapshot => ({
  ...snapshot,
  head: value,
});

const setSpecial = (
  snapshot: GitSnapshot,
  key: keyof GitSnapshot["special"],
  value: string | boolean,
): GitSnapshot => ({
  ...snapshot,
  special: { ...snapshot.special, [key]: value },
});

describe("buildGitSnapshot", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-git-snapshot-"));
    createRepo(repoRoot);
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("reads HEAD and local branch refs", () => {
    const snapshot = buildGitSnapshot(path.join(repoRoot, ".git"));
    expect(snapshot).not.toBeNull();
    expect(snapshot?.head).toBe("ref: refs/heads/main");
    expect(snapshot?.refs.get("heads/main")).toBe(sha(1));
  });
});

describe("classifyGitChanges", () => {
  let base: GitSnapshot;

  beforeEach(() => {
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-git-classify-"));
    createRepo(repoRoot);
    const snapshot = buildGitSnapshot(path.join(repoRoot, ".git"));
    if (!snapshot) throw new Error("failed to build snapshot");
    base = snapshot;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("classifies a branch ref advance as git-commit", () => {
    const next = addRef(base, "heads/main", sha(2));
    expect(classifyGitChanges(base, next)).toEqual(["git-branch-change", "git-commit"]);
  });

  it("classifies a HEAD change as git-checkout", () => {
    const next = setHead(base, sha(99));
    expect(classifyGitChanges(base, next)).toEqual(["git-head-change", "git-checkout"]);
  });

  it("classifies a merge when MERGE_HEAD was present", () => {
    const withMergeHead = setSpecial(base, "mergeHead", sha(50));
    const merged = addRef(withMergeHead, "heads/main", sha(2));
    expect(classifyGitChanges(withMergeHead, merged)).toEqual(["git-branch-change", "git-merge"]);
  });

  it("classifies a rebase when the rebase directory was present", () => {
    const withRebase = setSpecial(base, "rebaseMergeExists", true);
    const rebased = addRef(withRebase, "heads/main", sha(2));
    expect(classifyGitChanges(withRebase, rebased)).toEqual(["git-branch-change", "git-rebase"]);
  });

  it("classifies a cherry-pick when CHERRY_PICK_HEAD was present", () => {
    const withCherryPick = setSpecial(base, "cherryPickHead", sha(50));
    const picked = addRef(withCherryPick, "heads/main", sha(2));
    expect(classifyGitChanges(withCherryPick, picked)).toEqual([
      "git-branch-change",
      "git-cherry-pick",
    ]);
  });

  it("classifies a reset when ORIG_HEAD appears", () => {
    const reset = addRef(setSpecial(base, "origHead", sha(1)), "heads/main", sha(2));
    expect(classifyGitChanges(base, reset)).toEqual(["git-branch-change", "git-reset"]);
  });

  it("classifies a remote ref change as git-fetch", () => {
    const next = addRef(base, "remotes/origin/main", sha(4));
    expect(classifyGitChanges(base, next)).toEqual(["git-remote-change", "git-fetch"]);
  });

  it("classifies a new tag as git-tag", () => {
    const next = addRef(base, "tags/v1", sha(5));
    expect(classifyGitChanges(base, next)).toEqual(["git-tag-change", "git-tag"]);
  });

  it("classifies a stash change as git-stash", () => {
    const next = addRef(base, "stash", sha(6));
    expect(classifyGitChanges(base, next)).toEqual(["git-stash-change", "git-stash"]);
  });

  it("returns an empty array when nothing changed", () => {
    expect(classifyGitChanges(base, base)).toEqual([]);
  });
});
