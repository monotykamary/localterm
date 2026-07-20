import {
  GIT_CACHE_TTL_MS,
  GIT_DIFF_CACHE_MAX_BYTES,
  GIT_DIFF_CACHE_MAX_ENTRIES,
} from "./constants.js";
import type { GitDiffFileMeta, GitDiffMode, GitDiffSummary } from "./types.js";

// Diff cache. A single full diff pass (one `git diff --numstat/-z`, one
// `--name-status -z`, one `--patch`, one untracked `ls-files`) is the whole
// cost of a branch comparison; the viewer's prefetch queue then asks for
// ~every file's patch, and without a cache each request re-ran that pass —
// O(files²). The cache holds the built pass for `(cwd, mode, base)` and is
// invalidated on a git-dirty signal (exported `invalidateGitDiffCache`) with a
// TTL backstop so a missed invalidation can't serve a stale tree indefinitely.
export interface DiffCache {
  summary: GitDiffSummary;
  fileMeta: GitDiffFileMeta[];
  filePatchByPath: Map<string, string | null>;
  fileBinaryByPath: Map<string, boolean>;
  filePatchOmittedByPath: Map<string, boolean>;
  retainedBytes: number;
  builtAt: number;
}

// Nested so a cwd can hold more than one comparison (the working-tree summary
// is pushed on git-dirty while the viewer may be open in branch mode).
const diffCacheByCwd = new Map<string, Map<string, DiffCache>>();

const comparisonKey = (mode: GitDiffMode, base: string | null): string => `${mode}:${base ?? ""}`;

const pruneDiffCache = (): void => {
  while (true) {
    let entryCount = 0;
    let retainedBytes = 0;
    let oldestCwd: string | undefined;
    let oldestComparison: string | undefined;
    let oldestBuiltAt = Number.POSITIVE_INFINITY;
    for (const [cwd, byComparison] of diffCacheByCwd) {
      for (const [comparison, cache] of byComparison) {
        entryCount += 1;
        retainedBytes += cache.retainedBytes;
        if (cache.builtAt >= oldestBuiltAt) continue;
        oldestBuiltAt = cache.builtAt;
        oldestCwd = cwd;
        oldestComparison = comparison;
      }
    }
    if (entryCount <= GIT_DIFF_CACHE_MAX_ENTRIES && retainedBytes <= GIT_DIFF_CACHE_MAX_BYTES) {
      return;
    }
    if (oldestCwd === undefined || oldestComparison === undefined) return;
    const byComparison = diffCacheByCwd.get(oldestCwd);
    byComparison?.delete(oldestComparison);
    if (byComparison?.size === 0) diffCacheByCwd.delete(oldestCwd);
  }
};

export const readDiffCache = (
  cwd: string,
  mode: GitDiffMode,
  base: string | null,
): DiffCache | null => {
  const byComparison = diffCacheByCwd.get(cwd);
  if (!byComparison) return null;
  const entry = byComparison.get(comparisonKey(mode, base));
  if (!entry) return null;
  if (Date.now() - entry.builtAt > GIT_CACHE_TTL_MS) {
    byComparison.delete(comparisonKey(mode, base));
    if (byComparison.size === 0) diffCacheByCwd.delete(cwd);
    return null;
  }
  return entry;
};

export const writeDiffCache = (
  cwd: string,
  mode: GitDiffMode,
  base: string | null,
  cache: DiffCache,
): void => {
  let byComparison = diffCacheByCwd.get(cwd);
  if (!byComparison) {
    byComparison = new Map();
    diffCacheByCwd.set(cwd, byComparison);
  }
  byComparison.set(comparisonKey(mode, base), cache);
  pruneDiffCache();
};

export const invalidateGitDiffCache = (cwd: string): void => {
  diffCacheByCwd.delete(cwd);
};
