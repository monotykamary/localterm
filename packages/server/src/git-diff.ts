import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { runGit } from "./utils/run-git.js";
import { resolveGithubToken } from "./utils/resolve-github-token.js";
import { memoBy } from "./utils/memo-by.js";
import {
  GIT_BINARY_SNIFF_BYTES,
  GIT_CACHE_TTL_MS,
  GIT_EMPTY_TREE_HASH,
  GIT_MAX_BRANCHES,
  GIT_MAX_PATCH_BYTES_PER_FILE,
  GIT_MAX_TOTAL_PATCH_BYTES,
  GIT_MAX_UNTRACKED_FILE_BYTES,
  GIT_MAX_UNTRACKED_FILES,
  GIT_PR_CACHE_TTL_MS,
} from "./constants.js";
import type {
  GitBaseSource,
  GitBranchInfo,
  GitBranchPr,
  GitBranchPrState,
  GitDiffFile,
  GitDiffFileListResponse,
  GitDiffFileMeta,
  GitDiffFilePatch,
  GitDiffFileStatus,
  GitDiffMode,
  GitDiffResponse,
  GitDiffSummary,
} from "./types.js";

export interface GitDiffOptions {
  mode: GitDiffMode;
  base?: string | null;
}

const WORKING_OPTIONS: GitDiffOptions = { mode: "working" };

const EMPTY_SUMMARY: GitDiffSummary = {
  isRepo: false,
  files: 0,
  additions: 0,
  deletions: 0,
  binaries: 0,
  branch: null,
};

// Diff cache. A single full diff pass (one `git diff --numstat/-z`, one
// `--name-status -z`, one `--patch`, one untracked `ls-files`) is the whole
// cost of a branch comparison; the viewer's prefetch queue then asks for
// ~every file's patch, and without a cache each request re-ran that pass —
// O(files²). The cache holds the built pass for `(cwd, mode, base)` and is
// invalidated on a git-dirty signal (exported `invalidateGitDiffCache`) with a
// TTL backstop so a missed invalidation can't serve a stale tree indefinitely.
interface DiffCache {
  summary: GitDiffSummary;
  fileMeta: GitDiffFileMeta[];
  filePatchByPath: Map<string, string | null>;
  fileBinaryByPath: Map<string, boolean>;
  filePatchOmittedByPath: Map<string, boolean>;
  builtAt: number;
}

// Nested so a cwd can hold more than one comparison (the working-tree summary
// is pushed on git-dirty while the viewer may be open in branch mode).
const diffCacheByCwd = new Map<string, Map<string, DiffCache>>();

const comparisonKey = (mode: GitDiffMode, base: string | null): string => `${mode}:${base ?? ""}`;

const readDiffCache = (cwd: string, mode: GitDiffMode, base: string | null): DiffCache | null => {
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

const writeDiffCache = (
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
};

export const invalidateGitDiffCache = (cwd: string): void => {
  diffCacheByCwd.delete(cwd);
};

// PR detection cache, keyed by (cwd, branch). The client's `getGitBranchPr` call
// (fired in parallel with `getGitBranchInfo` on viewer open) populates this, so
// by the time `branchInfo?.pr` is truthy client-side and the viewer opens into
// branch mode, the server cache is warm — and `resolveEffectiveBaseRef` can
// read the PR's base repo without a GitHub round-trip on the diff path (which is
// local-only by design). The branch is part of the key, so switching branches
// misses and the next `getGitBranchPr` refetches; a TTL backstops a stale entry.
interface PrCache {
  pr: ParsedPr | null;
  builtAt: number;
}

const prCacheByCwd = new Map<string, Map<string, PrCache>>();

const readPrCache = (cwd: string, branch: string): ParsedPr | null | undefined => {
  const byBranch = prCacheByCwd.get(cwd);
  if (!byBranch) return undefined;
  const entry = byBranch.get(branch);
  if (!entry) return undefined;
  if (Date.now() - entry.builtAt > GIT_PR_CACHE_TTL_MS) {
    byBranch.delete(branch);
    if (byBranch.size === 0) prCacheByCwd.delete(cwd);
    return undefined;
  }
  return entry.pr;
};

const writePrCache = (cwd: string, branch: string, pr: ParsedPr | null): void => {
  let byBranch = prCacheByCwd.get(cwd);
  if (!byBranch) {
    byBranch = new Map();
    prCacheByCwd.set(cwd, byBranch);
  }
  byBranch.set(branch, { pr, builtAt: Date.now() });
};

const runGitText = async (cwd: string, args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  return result.stdout.toString("utf8");
};

// `git diff` flags shared by every diff invocation so numstat, name-status and
// patch all walk the same diff queue (same rename detection, same file order).
const DIFF_RENAME_FLAG = "--find-renames";

const isGitRepo = async (cwd: string): Promise<boolean> => {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0;
};

const getCurrentBranch = async (cwd: string): Promise<string | null> => {
  const result = await runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (result.exitCode !== 0) return null;
  const name = result.stdout.toString("utf8").trim();
  return name === "HEAD" ? null : name;
};

interface RefInfo {
  ref: string;
  source: GitBaseSource;
}

// working mode compares against HEAD (or the empty tree when the branch is
// unborn). branch mode compares against the merge-base of HEAD and the base
// ref, so only changes since the branches diverged are shown.
const resolveDiffBaseRef = async (cwd: string): Promise<string> => {
  const result = await runGit(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  return result.exitCode === 0 ? "HEAD" : GIT_EMPTY_TREE_HASH;
};

const verifyRef = async (cwd: string, ref: string): Promise<boolean> => {
  const result = await runGit(cwd, ["rev-parse", "--verify", "-q", ref]);
  return result.exitCode === 0;
};

const resolveDefaultBase = async (cwd: string): Promise<RefInfo | null> => {
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

const resolveEffectiveBaseRef = async (
  cwd: string,
  options: GitDiffOptions,
): Promise<string | null> => {
  if (options.mode !== "branch") return resolveDiffBaseRef(cwd);

  let baseRef = options.base?.trim() || null;
  if (baseRef && !(await verifyRef(cwd, baseRef))) baseRef = null;
  // No explicit user override: a fork PR compares against its upstream base
  // (the PR's base repo's default branch), not the fork's own default. The PR is
  // read from the per-(cwd, branch) cache populated by getGitBranchPr — no GitHub
  // round-trip here — so the diff stays local and the cache's branch key means a
  // branch switch naturally misses. Cold cache (PR not yet resolved) degrades to
  // the repo default; self-corrects once getGitBranchPr lands and the viewer
  // re-leases the diff.
  if (!baseRef) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch) {
      const cachedPr = readPrCache(cwd, currentBranch);
      if (cachedPr) {
        const remotes = await parseGithubRemotes(cwd);
        const prBase = await resolvePrBaseRef(cwd, cachedPr, remotes);
        if (prBase) baseRef = prBase.ref;
      }
    }
  }
  if (!baseRef) baseRef = (await resolveDefaultBase(cwd))?.ref ?? null;
  if (!baseRef) return null;

  const mergeBase = await runGit(cwd, ["merge-base", baseRef, "HEAD"]);
  if (mergeBase.exitCode === 0) return mergeBase.stdout.toString("utf8").trim();
  if (!(await verifyRef(cwd, baseRef))) return null;
  return runGitText(cwd, ["rev-parse", "--verify", baseRef]);
};

const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  if (!text.endsWith("\n")) count += 1;
  return count;
};

interface UntrackedFile {
  path: string;
  binary: boolean;
  lines: number;
  content: string | null;
  truncated: boolean;
}

const readUntrackedFile = async (cwd: string, filePath: string): Promise<UntrackedFile | null> => {
  const absolutePath = path.join(cwd, filePath);
  try {
    const stat = await fsPromises.stat(absolutePath);
    if (!stat.isFile()) return null;
    const bytesToRead = Math.min(stat.size, GIT_MAX_UNTRACKED_FILE_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const handle = await fsPromises.open(absolutePath, "r");
    try {
      const { buffer: readBuffer } = await handle.read(buffer, 0, bytesToRead, 0);
      const sniffEnd = Math.min(readBuffer.length, GIT_BINARY_SNIFF_BYTES);
      const binary = readBuffer.subarray(0, sniffEnd).includes(0);
      const truncated = stat.size > GIT_MAX_UNTRACKED_FILE_BYTES;
      const content = binary ? null : truncated ? null : readBuffer.toString("utf8");
      const lines = binary ? 0 : content ? countLines(content) : 0;
      return { path: filePath, binary, lines, content, truncated };
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
};

const collectUntrackedFiles = async (cwd: string): Promise<UntrackedFile[]> => {
  const result = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (result.exitCode !== 0) return [];
  const paths = result.stdout.toString("utf8").split("\0").filter(Boolean);

  const files: UntrackedFile[] = [];
  for (const filePath of paths) {
    if (files.length >= GIT_MAX_UNTRACKED_FILES) break;
    const file = await readUntrackedFile(cwd, filePath);
    if (file) files.push(file);
  }
  return files;
};

export const buildUntrackedPatch = (content: string): string => {
  if (content.length === 0) return "";
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = hasTrailingNewline ? "" : "\n\\ No newline at end of file";
  return `@@ -0,0 +1,${lines.length} @@\n${body}${noNewlineMarker}\n`;
};

export const splitPatchByFile = (raw: string): string[] =>
  raw.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));

export interface NumstatEntry {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

export const parseNumstatZ = (raw: string): NumstatEntry[] => {
  const tokens = raw.split("\0");
  const entries: NumstatEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(token);
    if (!match) continue;
    const binary = match[1] === "-" || match[2] === "-";
    const additions = binary ? 0 : Number.parseInt(match[1], 10);
    const deletions = binary ? 0 : Number.parseInt(match[2], 10);
    if (match[3]) {
      entries.push({ path: match[3], oldPath: null, additions, deletions, binary });
      continue;
    }
    const oldPath = tokens[index + 1];
    const newPath = tokens[index + 2];
    index += 2;
    if (!oldPath || !newPath) continue;
    entries.push({ path: newPath, oldPath, additions, deletions, binary });
  }
  return entries;
};

export const parseNameStatusZ = (raw: string): Map<string, GitDiffFileStatus> => {
  const tokens = raw.split("\0");
  const statuses = new Map<string, GitDiffFileStatus>();
  for (let index = 0; index < tokens.length; index += 1) {
    const statusToken = tokens[index];
    if (!statusToken) continue;
    const letter = statusToken[0];
    if (letter === "R" || letter === "C") {
      const newPath = tokens[index + 2];
      index += 2;
      if (!newPath) continue;
      statuses.set(newPath, letter === "R" ? "renamed" : "added");
      continue;
    }
    const filePath = tokens[index + 1];
    index += 1;
    if (!filePath) continue;
    if (letter === "A") statuses.set(filePath, "added");
    else if (letter === "D") statuses.set(filePath, "deleted");
    else statuses.set(filePath, "modified");
  }
  return statuses;
};

// Undo git's C-style path quoting (paths with spaces/special chars get wrapped
// in "..." with \-escapes; core.quotepath=false leaves only those, not non-ASCII).
const unquoteGitPath = (raw: string): string => {
  if (raw.length < 2 || raw[0] !== '"' || raw[raw.length - 1] !== '"') return raw;
  let out = "";
  let index = 1;
  const end = raw.length - 1;
  while (index < end) {
    const char = raw[index];
    if (char === "\\" && index + 1 < end) {
      const next = raw[index + 1];
      if (next === "n") {
        out += "\n";
        index += 2;
      } else if (next === "t") {
        out += "\t";
        index += 2;
      } else if (next === '"') {
        out += '"';
        index += 2;
      } else if (next === "\\") {
        out += "\\";
        index += 2;
      } else if (next >= "0" && next <= "7" && index + 3 < end) {
        out += String.fromCharCode(Number.parseInt(raw.slice(index + 1, index + 4), 8));
        index += 4;
      } else {
        out += char;
        index += 1;
      }
    } else {
      out += char;
      index += 1;
    }
  }
  return out;
};

// Strip the `+++ ` / `--- ` prefix and the `b/` / `a/` namespace, unquoting if
// git wrapped the path. `/dev/null` (a deletion's +++ side) yields null so the
// caller can fall back to the --- side.
const pathFromLine = (line: string, prefix: string): string | null => {
  if (!line.startsWith(prefix)) return null;
  let rest = line.slice(prefix.length);
  if (rest === "/dev/null") return null;
  rest = unquoteGitPath(rest);
  // git appends a literal tab after an unquoted path in ---/+++ lines when the
  // path contains a space, to keep it from running into hunk content; the
  // closing quote already disambiguates quoted paths, so this only affects
  // the unquoted branch. Numstat/name-status never carry that tab, so strip it
  // or the path keys won't line up.
  if (rest.endsWith("\t")) rest = rest.slice(0, -1);
  if (rest.startsWith("b/")) return rest.slice(2);
  if (rest.startsWith("a/")) return rest.slice(2);
  return rest;
};

// Pull the new-side path out of one `diff --git` chunk: prefer `+++ b/<path>`
// (added/modified/rename target), fall back to `--- a/<path>` for deletions
// (whose +++ is /dev/null), then to `rename to <path>` for a pure rename with
// no content change (which has no ---/+++ lines at all).
const extractPatchPath = (chunk: string): string | null => {
  const lines = chunk.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      const fromNew = pathFromLine(line, "+++ ");
      if (fromNew !== null) return fromNew;
      for (const fallback of lines) {
        if (fallback.startsWith("--- ")) {
          const fromOld = pathFromLine(fallback, "--- ");
          if (fromOld !== null) return fromOld;
        }
      }
      return null;
    }
  }
  for (const line of lines) {
    if (line.startsWith("rename to ")) return unquoteGitPath(line.slice("rename to ".length));
  }
  return null;
};

// Index `git diff --patch` output by path. A single path can map to several
// `diff --git` blocks (a symlink re-added as a regular file emits a deletion +
// an addition for one path), so those are concatenated back into one patch.
const indexPatchesByPath = (raw: string): Map<string, string> => {
  const chunksByPath = new Map<string, string[]>();
  for (const chunk of splitPatchByFile(raw)) {
    const patchPath = extractPatchPath(chunk);
    if (patchPath === null) continue;
    let chunks = chunksByPath.get(patchPath);
    if (!chunks) {
      chunks = [];
      chunksByPath.set(patchPath, chunks);
    }
    chunks.push(chunk);
  }
  const result = new Map<string, string>();
  for (const [patchPath, chunks] of chunksByPath) {
    result.set(patchPath, chunks.join(""));
  }
  return result;
};

// One full diff pass for `(cwd)` against `baseRef`. Three parallel `git diff`
// invocations (numstat for counts+binary, name-status for the status letter +
// rename old path, patch for the body) walk the same diff queue. numstat and
// name-status are NUL-delimited and unambiguous; they're the source of truth
// for the file list. The patch output is keyed by path rather than paired
// positionally, because a single numstat entry can span several `diff --git`
// blocks (a symlink is deleted as mode 120000 and re-added as a regular file:
// git emits that as a deletion + an addition sharing one path, so there's no
// 1:1 with numstat entries). Untracked files are folded in from `ls-files`
// with synthesized patches (git's own diff never lists untracked files).
const buildDiffCache = async (cwd: string, baseRef: string): Promise<DiffCache | null> => {
  const [numstatRes, nameStatusRes, patchRes] = await Promise.all([
    runGit(cwd, [
      "-c",
      "core.quotepath=false",
      "diff",
      DIFF_RENAME_FLAG,
      "--numstat",
      "-z",
      baseRef,
    ]),
    runGit(cwd, [
      "-c",
      "core.quotepath=false",
      "diff",
      DIFF_RENAME_FLAG,
      "--name-status",
      "-z",
      baseRef,
    ]),
    runGit(cwd, ["-c", "core.quotepath=false", "diff", DIFF_RENAME_FLAG, "--patch", baseRef]),
  ]);
  if (numstatRes.exitCode !== 0 || patchRes.exitCode !== 0) return null;

  const numstat = parseNumstatZ(numstatRes.stdout.toString("utf8"));
  const statuses = parseNameStatusZ(nameStatusRes.stdout.toString("utf8"));
  const patchesByPath = indexPatchesByPath(patchRes.stdout.toString("utf8"));
  const untracked = await collectUntrackedFiles(cwd);

  const fileMeta: GitDiffFileMeta[] = [];
  const filePatchByPath = new Map<string, string | null>();
  const fileBinaryByPath = new Map<string, boolean>();
  const filePatchOmittedByPath = new Map<string, boolean>();

  let totalPatchBytes = 0;
  let additions = 0;
  let deletions = 0;
  let binaries = 0;

  for (let index = 0; index < numstat.length; index += 1) {
    const entry = numstat[index];
    const status = statuses.get(entry.path) ?? "modified";
    const oldPath = status === "renamed" ? entry.oldPath : null;

    let patchText: string | null = null;
    let patchOmitted = false;

    if (entry.binary) {
      binaries += 1;
    } else {
      const rawPatch = patchesByPath.get(entry.path) ?? null;
      if (
        rawPatch === null ||
        rawPatch.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + rawPatch.length > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        patchOmitted = true;
      } else {
        patchText = rawPatch;
        totalPatchBytes += rawPatch.length;
      }
      additions += entry.additions;
      deletions += entry.deletions;
    }

    fileMeta.push({
      path: entry.path,
      oldPath,
      status,
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
    });
    filePatchByPath.set(entry.path, patchText);
    fileBinaryByPath.set(entry.path, entry.binary);
    filePatchOmittedByPath.set(entry.path, patchOmitted);
  }

  for (const file of untracked) {
    const patch = file.binary
      ? null
      : file.truncated || file.content === null
        ? null
        : buildUntrackedPatch(file.content);
    let patchOmitted = file.truncated;
    if (patch !== null) {
      if (
        patch.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + patch.length > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        patchOmitted = true;
      } else {
        totalPatchBytes += patch.length;
      }
    }

    const fileAdditions = file.binary ? 0 : file.lines;
    if (file.binary) binaries += 1;
    additions += fileAdditions;

    fileMeta.push({
      path: file.path,
      oldPath: null,
      status: "untracked",
      additions: fileAdditions,
      deletions: 0,
      binary: file.binary,
    });
    filePatchByPath.set(file.path, patchOmitted ? null : patch);
    fileBinaryByPath.set(file.path, file.binary);
    filePatchOmittedByPath.set(file.path, patchOmitted);
  }

  const summary: GitDiffSummary = {
    isRepo: true,
    files: fileMeta.length,
    additions,
    deletions,
    binaries,
    branch: await getCurrentBranch(cwd),
  };

  return {
    summary,
    fileMeta,
    filePatchByPath,
    fileBinaryByPath,
    filePatchOmittedByPath,
    builtAt: Date.now(),
  };
};

const ensureDiffCache = async (cwd: string, options: GitDiffOptions): Promise<DiffCache | null> => {
  // Read the cache before resolving the base ref — that resolution does git work
  // (rev-parse + merge-base) on every call, so for the per-file patch endpoint
  // (where the cache is warm on nearly every request) checking first keeps it a
  // pure map lookup with no subprocess.
  const cached = readDiffCache(cwd, options.mode, options.base ?? null);
  if (cached) return cached;

  const baseRef = await resolveEffectiveBaseRef(cwd, options);
  if (baseRef === null) return null;

  const cache = await buildDiffCache(cwd, baseRef);
  if (cache) writeDiffCache(cwd, options.mode, options.base ?? null, cache);
  return cache;
};

export const getGitDiffSummary = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffSummary> => {
  const cached = readDiffCache(cwd, options.mode, options.base ?? null);
  if (cached) return cached.summary;

  if (!(await isGitRepo(cwd))) return EMPTY_SUMMARY;

  try {
    const baseRef = await resolveEffectiveBaseRef(cwd, options);
    if (baseRef === null) return { ...EMPTY_SUMMARY, isRepo: true };
    const branch = await getCurrentBranch(cwd);

    // Summary is pushed on every git-dirty signal, so it stays on the cheap
    // numstat-only path (no patch) unless a cache is already warm.
    const numstatRes = await runGit(cwd, [
      "-c",
      "core.quotepath=false",
      "diff",
      DIFF_RENAME_FLAG,
      "--numstat",
      "-z",
      baseRef,
    ]);
    if (numstatRes.exitCode !== 0) return { ...EMPTY_SUMMARY, isRepo: true };

    let additions = 0;
    let deletions = 0;
    let binaries = 0;
    let fileCount = 0;
    for (const entry of parseNumstatZ(numstatRes.stdout.toString("utf8"))) {
      fileCount += 1;
      if (entry.binary) {
        binaries += 1;
        continue;
      }
      additions += entry.additions;
      deletions += entry.deletions;
    }

    const untracked = await collectUntrackedFiles(cwd);
    for (const file of untracked) {
      fileCount += 1;
      if (file.binary) {
        binaries += 1;
      } else {
        additions += file.lines;
      }
    }

    return { isRepo: true, files: fileCount, additions, deletions, binaries, branch };
  } catch {
    return { ...EMPTY_SUMMARY, isRepo: true };
  }
};

export const getGitDiff = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffResponse> => {
  const cached = readDiffCache(cwd, options.mode, options.base ?? null);
  if (cached) {
    return { isRepo: true, files: mapCacheFiles(cached) };
  }
  if (!(await isGitRepo(cwd))) return { isRepo: false, files: [] };
  const cache = await ensureDiffCache(cwd, options);
  if (!cache) return { isRepo: true, files: [] };
  return { isRepo: true, files: mapCacheFiles(cache) };
};

const mapCacheFiles = (cache: DiffCache): GitDiffFile[] =>
  cache.fileMeta.map((meta) => ({
    path: meta.path,
    oldPath: meta.oldPath,
    status: meta.status,
    additions: meta.additions,
    deletions: meta.deletions,
    binary: meta.binary,
    patch: cache.filePatchByPath.get(meta.path) ?? null,
    patchOmitted: cache.filePatchOmittedByPath.get(meta.path) ?? false,
  }));

export const getGitDiffFiles = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFileListResponse> => {
  const cached = readDiffCache(cwd, options.mode, options.base ?? null);
  if (cached) return { isRepo: true, files: cached.fileMeta };
  if (!(await isGitRepo(cwd))) return { isRepo: false, files: [] };
  const cache = await ensureDiffCache(cwd, options);
  if (!cache) return { isRepo: true, files: [] };
  return { isRepo: true, files: cache.fileMeta };
};

export const getGitDiffFilePatch = async (
  cwd: string,
  requestedPath: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  const cache = await ensureDiffCache(cwd, options);
  if (!cache) return empty;

  // O(1) lookup: the full diff pass that the per-file patch needs was already
  // computed once for this (cwd, mode, base) and cached. This was the O(N²)
  // regression — each per-file request re-ran the whole-tree diff + a jsdiff
  // for every file. Now it's a map lookup.
  if (cache.filePatchByPath.has(requestedPath)) {
    return {
      patch: cache.filePatchByPath.get(requestedPath) ?? null,
      patchOmitted: cache.filePatchOmittedByPath.get(requestedPath) ?? false,
      binary: cache.fileBinaryByPath.get(requestedPath) ?? false,
    };
  }

  // An untracked path the cache didn't cover (created between the cache build
  // and this request) falls back to synthesizing from the working tree.
  return getGitDiffFilePatchFromWorkingTree(cwd, requestedPath);
};

const getGitDiffFilePatchFromWorkingTree = async (
  cwd: string,
  requestedPath: string,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  const absolutePath = path.join(cwd, requestedPath);
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return empty;
    const bytesToRead = Math.min(stat.size, GIT_MAX_UNTRACKED_FILE_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const handle = fs.openSync(absolutePath, "r");
    fs.readSync(handle, buffer, 0, bytesToRead, 0);
    fs.closeSync(handle);
    const sniffEnd = Math.min(buffer.length, GIT_BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffEnd).includes(0)) {
      return { patch: null, patchOmitted: false, binary: true };
    }
    const truncated = stat.size > GIT_MAX_UNTRACKED_FILE_BYTES;
    const content = truncated ? null : buffer.toString("utf8");
    const patch = truncated || content === null ? null : buildUntrackedPatch(content);
    if (patch !== null && patch.length > GIT_MAX_PATCH_BYTES_PER_FILE) {
      return { patch: null, patchOmitted: true, binary: false };
    }
    return { patch, patchOmitted: truncated, binary: false };
  } catch {
    return empty;
  }
};

// ParsedPr carries the PR's base repo full name alongside the wire fields so
// the diff path can map the PR base to a local remote WITHOUT re-fetching (the
// GitHub round-trip already happened in getGitBranchPr). headOwner is the same
// kind of internal-only field; neither leaks to GitBranchPr on the wire.
type ParsedPr = GitBranchPr & {
  headOwner: string | null;
  baseRepoFullName: string | null;
};

const normalizeOctokitPrState = (state: string, mergedAt: string | null): GitBranchPrState => {
  if (mergedAt !== null) return "merged";
  if (state === "closed") return "closed";
  return "open";
};

export interface PrFetcher {
  list(slug: string, head: string, state: string, perPage: number): Promise<ParsedPr[]>;
}

const defaultPrFetcher: PrFetcher = {
  list: async (slug, head, _state, perPage) => {
    const token = await resolveGithubToken();
    if (!token) return [];

    try {
      const [owner, repo] = slug.split("/");
      const octokit = new Octokit({ auth: token, request: { timeout: 8_000 } });
      const { data } = await octokit.rest.pulls.list({
        owner,
        repo,
        head,
        state: "all",
        per_page: perPage,
      });

      return data.map((pr) => ({
        number: pr.number,
        title: pr.title ?? "",
        baseRefName: pr.base?.ref ?? "",
        url: pr.html_url ?? null,
        state: normalizeOctokitPrState(pr.state, pr.merged_at),
        headOwner: pr.head?.repo?.owner?.login ?? null,
        baseRepoFullName: pr.base?.repo?.full_name ?? null,
      }));
    } catch {
      return [];
    }
  },
};

let activePrFetcher: PrFetcher = defaultPrFetcher;

export const setPrFetcher = (fetcher: PrFetcher): void => {
  activePrFetcher = fetcher;
};

interface GithubRemote {
  name: string;
  slug: string;
  owner: string;
}

const parseGithubRemotes = async (cwd: string): Promise<GithubRemote[]> => {
  const result = await runGit(cwd, ["remote", "-v"]);
  if (result.exitCode !== 0) return [];

  const raw: GithubRemote[] = [];
  const seen = new Set<string>();
  for (const line of result.stdout.toString("utf8").split("\n")) {
    const match = /^(\S+)\t(.+?)\s+\(fetch\)$/.exec(line);
    if (!match) continue;
    const [, name, url] = match;
    if (seen.has(name)) continue;
    seen.add(name);
    const urlMatch = /github\.com[/:]([^\s/]+)\/([^\s]+?)(?:\.git)?$/i.exec(url);
    if (!urlMatch) continue;
    const [, owner, repoName] = urlMatch;
    raw.push({ name, slug: `${owner}/${repoName}`, owner });
  }

  return memoBy(raw, (remote) => `${remote.name} ${remote.slug}`);
};

// The wire type strips the internal-only fields (headOwner, baseRepoFullName)
// so they never reach the client.
const toWirePr = (pr: ParsedPr): GitBranchPr => ({
  number: pr.number,
  title: pr.title,
  baseRefName: pr.baseRefName,
  url: pr.url,
  state: pr.state,
});

// detectPr returns the full ParsedPr (headOwner + baseRepoFullName retained)
// and caches it per (cwd, branch) so the diff path can resolve a fork PR's
// upstream base without a second GitHub round-trip. getGitBranchPr maps to the
// wire type; resolveEffectiveBaseRef reads the cache directly.
const detectPr = async (cwd: string): Promise<ParsedPr | null> => {
  const currentBranch = await getCurrentBranch(cwd);
  if (!currentBranch) return null;
  const remotes = await parseGithubRemotes(cwd);
  if (remotes.length === 0) return null;
  const ownRemote = remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  const ownOwner = ownRemote.owner.toLowerCase();
  const slugs = memoBy(remotes, (remote) => remote.slug).map((remote) => remote.slug);

  const results = await Promise.all(
    slugs.map((slug) => activePrFetcher.list(slug, `${ownOwner}:${currentBranch}`, "all", 30)),
  );

  const candidates = memoBy(
    results.flat().filter((pr) => pr.headOwner && pr.headOwner.toLowerCase() === ownOwner),
    (pr) => pr.url ?? `#${pr.number}`,
  );
  const openPr = candidates.find((pr) => pr.state === "open");
  const chosen = openPr ?? candidates[0] ?? null;
  writePrCache(cwd, currentBranch, chosen);
  return chosen;
};

// Map a detected PR's base repo to a local remote, returning the remote-tracking
// ref to diff against. A fork PR targets the upstream repo (e.g. them/repo);
// `git diff` against `upstream/<baseRefName>` then shows only the branch's own
// changes, not drift between the fork's default branch and upstream. Falls back
// to null when the base repo isn't a configured remote (upstream never added) or
// the ref isn't fetched locally — the caller degrades to the repo default.
const resolvePrBaseRef = async (
  cwd: string,
  pr: ParsedPr,
  remotes: GithubRemote[],
): Promise<RefInfo | null> => {
  if (!pr.baseRepoFullName || !pr.baseRefName) return null;
  const remote = remotes.find((candidate) => candidate.slug === pr.baseRepoFullName);
  if (!remote) return null;
  const candidate = `${remote.name}/${pr.baseRefName}`;
  return (await verifyRef(cwd, candidate)) ? { ref: candidate, source: "pr" } : null;
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

export const listGithubRemoteSlugs = async (cwd: string): Promise<string[]> => {
  const remotes = await parseGithubRemotes(cwd);
  return memoBy(remotes, (remote) => remote.slug).map((remote) => remote.slug);
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

export const getGitBranchPr = async (cwd: string): Promise<GitBranchPr | null> => {
  if (!(await isGitRepo(cwd))) return null;
  const detected = await detectPr(cwd);
  return detected ? toWirePr(detected) : null;
};
