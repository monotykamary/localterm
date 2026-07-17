import { GIT_MAX_BRANCHES } from "./constants.js";
import { runGit } from "./utils/run-git.js";
import type { GitBaseSource, GitBranchInfo } from "./types.js";

export interface RefInfo {
  ref: string;
  source: GitBaseSource;
}

export const isGitRepo = async (cwd: string): Promise<boolean> => {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0;
};

export const getCurrentBranch = async (cwd: string): Promise<string | null> => {
  const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) return null;
  const name = result.stdout.toString("utf8").trim();
  return name === "HEAD" ? null : name;
};

export const verifyRef = async (cwd: string, ref: string): Promise<boolean> => {
  const result = await runGit(cwd, ["rev-parse", "--verify", "-q", ref]);
  return result.exitCode === 0;
};

export const resolveDefaultBase = async (cwd: string): Promise<RefInfo | null> => {
  const currentBranch = await getCurrentBranch(cwd);

  const symbolic = await runGit(cwd, ["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]);
  if (symbolic.exitCode === 0) {
    const target = symbolic.stdout.toString("utf8").trim();
    if (target.startsWith("refs/remotes/")) {
      const shortName = target.slice("refs/remotes/".length);
      if (shortName !== currentBranch && (await verifyRef(cwd, shortName))) {
        return { ref: shortName, source: "remoteHead" };
      }
    }
  }

  for (const name of ["main", "master", "develop"]) {
    if (name === currentBranch) continue;
    for (const candidate of [`origin/${name}`, name]) {
      if (await verifyRef(cwd, candidate)) return { ref: candidate, source: "fallback" };
    }
  }
  return null;
};

const listBranchesByRecency = async (cwd: string): Promise<string[]> => {
  const result = await runGit(cwd, [
    "for-each-ref",
    "--format=%(refname:short)",
    "--sort=-committerdate",
    "refs/heads",
    "refs/remotes",
  ]);
  if (result.exitCode !== 0) return [];
  const names: string[] = [];
  for (const name of result.stdout.toString("utf8").split("\n")) {
    if (!name || name.endsWith("/HEAD")) continue;
    names.push(name);
    if (names.length >= GIT_MAX_BRANCHES) break;
  }
  return names;
};

export const getGitBranchInfo = async (cwd: string): Promise<GitBranchInfo> => {
  if (!(await isGitRepo(cwd))) {
    return {
      isRepo: false,
      currentBranch: null,
      defaultBase: null,
      defaultBaseSource: null,
      branches: [],
      pr: null,
    };
  }

  const [currentBranch, defaultBase, branches] = await Promise.all([
    getCurrentBranch(cwd),
    resolveDefaultBase(cwd),
    listBranchesByRecency(cwd),
  ]);

  return {
    isRepo: true,
    currentBranch,
    defaultBase: defaultBase?.ref ?? null,
    defaultBaseSource: defaultBase?.source ?? null,
    branches,
    pr: null,
  };
};
