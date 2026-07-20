import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  GIT_BINARY_SNIFF_BYTES,
  GIT_EMPTY_TREE_HASH,
  GIT_MAX_PATCH_BYTES_PER_FILE,
  GIT_MAX_TOTAL_PATCH_BYTES,
  GIT_MAX_UNTRACKED_FILE_BYTES,
  GIT_MAX_UNTRACKED_FILES,
  GIT_MAX_UNTRACKED_TOTAL_BYTES,
  GIT_UNTRACKED_PATHS_MAX_BYTES,
} from "./constants.js";
import {
  getCurrentBranch,
  isGitRepo,
  resolveDefaultBase,
  verifyRef,
} from "./git-branch-metadata.js";
import { readDiffCache, writeDiffCache, type DiffCache } from "./git-diff-cache.js";
import {
  buildUntrackedPatch,
  countLines,
  indexPatchesByPath,
  parseNameStatusZ,
  parseNumstatZ,
} from "./git-diff-parser.js";
import { detectPrDeduped, readPrCache } from "./github-pr.js";
import { runGit } from "./utils/run-git.js";
import type {
  GitDiffFile,
  GitDiffFileListResponse,
  GitDiffFileMeta,
  GitDiffFilePatch,
  GitDiffMode,
  GitDiffResponse,
  GitDiffSummary,
} from "./types.js";

export interface GitDiffOptions {
  mode: GitDiffMode;
  base?: string | null;
}

interface UntrackedFile {
  path: string;
  binary: boolean;
  lines: number;
  content: string | null;
  truncated: boolean;
  bytesRead: number;
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

const runGitText = async (cwd: string, args: string[]): Promise<string> => {
  const result = await runGit(cwd, args);
  return result.stdout.toString("utf8");
};

// `git diff` flags shared by every diff invocation so numstat, name-status and
// patch all walk the same diff queue (same rename detection, same file order).
const DIFF_RENAME_FLAG = "--find-renames";

// working mode compares against HEAD (or the empty tree when the branch is
// unborn). branch mode compares against the merge-base of HEAD and the base
// ref, so only changes since the branches diverged are shown.
const resolveDiffBaseRef = async (cwd: string): Promise<string> => {
  const result = await runGit(cwd, ["rev-parse", "--verify", "-q", "HEAD"]);
  return result.exitCode === 0 ? "HEAD" : GIT_EMPTY_TREE_HASH;
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
  // round-trip in the warm case, so the diff stays local and the cache's branch
  // key means a branch switch naturally misses. A cold cache (the viewer opened
  // branch mode before getGitBranchPr landed, or a refresh raced it) resolves the
  // PR inline via detectPrDeduped — which shares any in-flight getGitBranchPr
  // call — rather than silently falling back to the fork's origin, which would
  // mismatch the PR's base. A cached null (known no-PR) skips; so does a PR whose
  // base resolves no usable ref; both degrade to the repo default below.
  if (!baseRef) {
    const currentBranch = await getCurrentBranch(cwd);
    if (currentBranch) {
      let cachedPr = readPrCache(cwd, currentBranch);
      if (cachedPr === undefined) {
        await detectPrDeduped(cwd);
        cachedPr = readPrCache(cwd, currentBranch);
      }
      // detectPr resolved (and fetched, if needed) the base ref alongside the
      // GitHub call, so the diff path reads it warm — no remote resolution here.
      if (cachedPr?.baseRef) baseRef = cachedPr.baseRef;
    }
  }
  if (!baseRef) baseRef = (await resolveDefaultBase(cwd))?.ref ?? null;
  if (!baseRef) return null;

  const mergeBase = await runGit(cwd, ["merge-base", baseRef, "HEAD"]);
  if (mergeBase.exitCode === 0) return mergeBase.stdout.toString("utf8").trim();
  if (!(await verifyRef(cwd, baseRef))) return null;
  return runGitText(cwd, ["rev-parse", "--verify", baseRef]);
};

const readUntrackedFile = async (
  cwd: string,
  filePath: string,
  remainingBytes: number,
  includeContent: boolean,
): Promise<UntrackedFile | null> => {
  const absolutePath = path.join(cwd, filePath);
  try {
    const stat = await fsPromises.stat(absolutePath);
    if (!stat.isFile()) return null;
    const bytesToRead = Math.min(
      stat.size,
      GIT_MAX_UNTRACKED_FILE_BYTES,
      Math.max(0, remainingBytes),
    );
    let readBuffer = Buffer.alloc(0);
    if (bytesToRead > 0) {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const handle = await fsPromises.open(absolutePath, "r");
      try {
        const result = await handle.read(buffer, 0, bytesToRead, 0);
        readBuffer = buffer.subarray(0, result.bytesRead);
      } finally {
        await handle.close();
      }
    }
    const sniffEnd = Math.min(readBuffer.length, GIT_BINARY_SNIFF_BYTES);
    const binary = readBuffer.subarray(0, sniffEnd).includes(0);
    const truncated = stat.size > readBuffer.length;
    const decoded = binary ? null : readBuffer.toString("utf8");
    const content = includeContent && !truncated ? decoded : null;
    const lines = binary || decoded === null ? 0 : countLines(decoded);
    return {
      path: filePath,
      binary,
      lines,
      content,
      truncated,
      bytesRead: readBuffer.length,
    };
  } catch {
    return null;
  }
};

const collectUntrackedFiles = async (
  cwd: string,
  includeContent: boolean,
): Promise<UntrackedFile[]> => {
  const result = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"], {
    maxStdoutBytes: GIT_UNTRACKED_PATHS_MAX_BYTES,
  });
  if (result.exitCode !== 0 && !result.stdoutTruncated) return [];

  const paths: string[] = [];
  let pathStart = 0;
  while (paths.length < GIT_MAX_UNTRACKED_FILES) {
    const separator = result.stdout.indexOf(0, pathStart);
    if (separator < 0) break;
    const filePath = result.stdout.subarray(pathStart, separator).toString("utf8");
    if (filePath) paths.push(filePath);
    pathStart = separator + 1;
  }

  const files: UntrackedFile[] = [];
  let remainingBytes = GIT_MAX_UNTRACKED_TOTAL_BYTES;
  for (const filePath of paths) {
    const file = await readUntrackedFile(cwd, filePath, remainingBytes, includeContent);
    if (!file) continue;
    files.push(file);
    remainingBytes = Math.max(0, remainingBytes - file.bytesRead);
  }
  return files;
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
    runGit(cwd, ["-c", "core.quotepath=false", "diff", DIFF_RENAME_FLAG, "--patch", baseRef], {
      maxStdoutBytes: GIT_MAX_TOTAL_PATCH_BYTES,
    }),
  ]);
  if (
    numstatRes.exitCode !== 0 ||
    nameStatusRes.exitCode !== 0 ||
    (patchRes.exitCode !== 0 && !patchRes.stdoutTruncated)
  ) {
    return null;
  }

  const numstat = parseNumstatZ(numstatRes.stdout.toString("utf8"));
  const statuses = parseNameStatusZ(nameStatusRes.stdout.toString("utf8"));
  const patchesByPath = patchRes.stdoutTruncated
    ? new Map<string, string>()
    : indexPatchesByPath(patchRes.stdout.toString("utf8"));
  const untracked = await collectUntrackedFiles(cwd, true);

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
      const rawPatchBytes = rawPatch === null ? 0 : Buffer.byteLength(rawPatch, "utf8");
      if (
        rawPatch === null ||
        rawPatchBytes > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + rawPatchBytes > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        patchOmitted = true;
      } else {
        patchText = rawPatch;
        totalPatchBytes += rawPatchBytes;
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
      const patchBytes = Buffer.byteLength(patch, "utf8");
      if (
        patchBytes > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + patchBytes > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        patchOmitted = true;
      } else {
        totalPatchBytes += patchBytes;
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
    retainedBytes: totalPatchBytes,
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

    const untracked = await collectUntrackedFiles(cwd, false);
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
    if (patch !== null && Buffer.byteLength(patch, "utf8") > GIT_MAX_PATCH_BYTES_PER_FILE) {
      return { patch: null, patchOmitted: true, binary: false };
    }
    return { patch, patchOmitted: truncated, binary: false };
  } catch {
    return empty;
  }
};
