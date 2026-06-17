import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { openRepository } from "es-git";
import { memoBy } from "./utils/memo-by.js";
import { computePatchFromContents } from "./utils/compute-patch.js";
import { resolveGithubToken } from "./utils/resolve-github-token.js";
import {
  GIT_BINARY_SNIFF_BYTES,
  GIT_CACHE_TTL_MS,
  GIT_EMPTY_TREE_HASH,
  GIT_MAX_BRANCHES,
  GIT_MAX_PATCH_BYTES_PER_FILE,
  GIT_MAX_TOTAL_PATCH_BYTES,
  GIT_MAX_UNTRACKED_FILE_BYTES,
  GIT_MAX_UNTRACKED_FILES,
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

const ZERO_OID = "0000000000000000000000000000000000000000";

// Diff cache. A single full diff pass (one tree diff + rename detection + one
// jsdiff per file) is the whole cost of a branch comparison; the viewer's
// prefetch queue then asks for ~every file's patch, and without a cache each
// request re-ran that full pass — O(files²). The cache holds the built pass
// for `(cwd, mode, base)` and is invalidated on a git-dirty signal (exported
// `invalidateGitDiffCache`) with a TTL backstop so a missed invalidation
// can't serve a stale tree indefinitely.
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

const collectIterator = <T>(iterable: unknown): T[] => {
  const result: T[] = [];
  for (const item of iterable as Iterable<T>) result.push(item);
  return result;
};

const deltaTypeToStatus = (delta: string): GitDiffFileStatus => {
  switch (delta) {
    case "Added":
      return "added";
    case "Deleted":
      return "deleted";
    case "Renamed":
      return "renamed";
    case "Copied":
      return "added";
    case "Untracked":
      return "untracked";
    case "Modified":
    case "Typechange":
    default:
      return "modified";
  }
};

interface OpenRepo {
  cwd: string;
  repo: Awaited<ReturnType<typeof openRepository>>;
}

const openRepo = async (cwd: string): Promise<OpenRepo | null> => {
  try {
    const repo = await openRepository(cwd);
    return { cwd, repo };
  } catch {
    return null;
  }
};

const getCurrentBranch = (r: OpenRepo): string | null => {
  try {
    const head = r.repo.head();
    const shorthand = head.shorthand();
    return shorthand && shorthand !== "HEAD" ? shorthand : null;
  } catch {
    return null;
  }
};

const resolveDiffBaseRef = (r: OpenRepo): string => {
  try {
    r.repo.head();
    return "HEAD";
  } catch {
    return GIT_EMPTY_TREE_HASH;
  }
};

interface RefInfo {
  ref: string;
  source: GitBaseSource;
}

const resolveDefaultBase = (r: OpenRepo): RefInfo | null => {
  const currentBranch = getCurrentBranch(r);

  try {
    const remoteHead = r.repo.getReference("refs/remotes/origin/HEAD");
    const symTarget = remoteHead.symbolicTarget();
    if (symTarget) {
      const shortName = symTarget.replace("refs/remotes/", "");
      if (shortName !== currentBranch) {
        try {
          r.repo.revparseSingle(shortName);
          return { ref: shortName, source: "remoteHead" };
        } catch {
          // stale origin/HEAD
        }
      }
    }
  } catch {
    // No origin/HEAD configured
  }

  for (const name of ["main", "master", "develop"]) {
    if (name === currentBranch) continue;
    for (const candidate of [`origin/${name}`, name]) {
      try {
        r.repo.revparseSingle(candidate);
        return { ref: candidate, source: "fallback" };
      } catch {
        continue;
      }
    }
  }
  return null;
};

const resolveEffectiveBaseRef = (r: OpenRepo, options: GitDiffOptions): string | null => {
  if (options.mode !== "branch") return resolveDiffBaseRef(r);

  let baseRef = options.base?.trim() || null;
  if (baseRef) {
    try {
      r.repo.revparseSingle(baseRef);
    } catch {
      baseRef = null;
    }
  }
  if (!baseRef) {
    const resolved = resolveDefaultBase(r);
    baseRef = resolved?.ref ?? null;
  }
  if (!baseRef) return null;

  try {
    const baseOid = r.repo.revparseSingle(baseRef);
    const headOid = r.repo.revparseSingle("HEAD");
    const mergeBase = r.repo.getMergeBase(baseOid, headOid);
    if (mergeBase) return mergeBase;
  } catch {
    // Unrelated histories
  }
  try {
    return r.repo.revparseSingle(baseRef);
  } catch {
    return null;
  }
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

const collectUntrackedFiles = async (r: OpenRepo): Promise<UntrackedFile[]> => {
  const files: UntrackedFile[] = [];
  const statuses = r.repo.statuses();
  const entries = collectIterator<{
    path: () => string;
    status: () => { wtNew: boolean; ignored: boolean };
  }>(statuses.iter());

  for (const entry of entries) {
    const s = entry.status();
    if (!s.wtNew || s.ignored) continue;
    if (files.length >= GIT_MAX_UNTRACKED_FILES) break;
    const filePath = entry.path();
    const absolutePath = path.join(r.cwd, filePath);

    try {
      const stat = await fsPromises.stat(absolutePath);
      if (!stat.isFile()) continue;
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
        files.push({ path: filePath, binary, lines, content, truncated });
      } finally {
        await handle.close();
      }
    } catch {
      continue;
    }
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

const readBlobContent = (r: OpenRepo, oid: string): string | null => {
  if (oid === ZERO_OID) return null;
  try {
    const obj = r.repo.findObject(oid);
    if (!obj) return null;
    const blob = obj.peelToBlob();
    return Buffer.from(blob.content()).toString("utf8");
  } catch {
    return null;
  }
};

const readWorkingTreeFile = (
  r: OpenRepo,
  filePath: string,
  maxBytes = GIT_MAX_UNTRACKED_FILE_BYTES,
): string | null => {
  const absolutePath = path.join(r.cwd, filePath);
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile()) return null;
    const bytesToRead = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(bytesToRead);
    const handle = fs.openSync(absolutePath, "r");
    fs.readSync(handle, buffer, 0, bytesToRead, 0);
    fs.closeSync(handle);
    const sniffEnd = Math.min(buffer.length, GIT_BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffEnd).includes(0)) return null;
    if (stat.size > maxBytes) return null;
    return buffer.toString("utf8");
  } catch {
    return null;
  }
};

interface DiffDeltaInfo {
  path: string;
  oldPath: string | null;
  status: GitDiffFileStatus;
  binary: boolean;
  oldId: string;
  newId: string;
}

const collectDeltaInfos = (
  diff: ReturnType<OpenRepo["repo"]["diffTreeToWorkdirWithIndex"]>,
): DiffDeltaInfo[] => {
  const deltas = collectIterator<{
    status: () => string;
    newFile: () => { path: () => string; isBinary: () => boolean; id: () => string };
    oldFile: () => { path: () => string; id: () => string };
  }>(diff.deltas());

  const result: DiffDeltaInfo[] = [];
  for (const delta of deltas) {
    const status = deltaTypeToStatus(delta.status());
    if (status === "untracked") continue;
    const newFile = delta.newFile();
    const oldFile = delta.oldFile();
    result.push({
      path: newFile.path(),
      oldPath: status === "renamed" ? oldFile.path() : null,
      status,
      binary: newFile.isBinary(),
      oldId: oldFile.id(),
      newId: newFile.id(),
    });
  }
  return result;
};

// Build a single delta's patch text + line counts from its old/new blobs (or
// the working-tree file). jsdiff's per-file counts are non-negative by
// construction, so they never trip the wire schema's `.nonnegative()`.
interface DeltaPatchResult {
  patchText: string | null;
  additions: number;
  deletions: number;
}

const buildDeltaPatch = (r: OpenRepo, delta: DiffDeltaInfo): DeltaPatchResult => {
  if (delta.binary) return { patchText: null, additions: 0, deletions: 0 };

  // All diff passes use diffTreeToWorkdirWithIndex, so the new side is the
  // working tree — read it straight from disk rather than the delta's blob id
  // (which points at the index/HEAD blob for unstaged edits and would read as
  // unchanged vs the old side → zero counts). The old side is the base tree's
  // blob.
  const oldContent = delta.status === "added" ? null : readBlobContent(r, delta.oldId);
  const newContent =
    delta.status === "deleted"
      ? null
      : readWorkingTreeFile(r, delta.path, GIT_MAX_TOTAL_PATCH_BYTES);

  const aPath = delta.oldPath ?? delta.path;
  try {
    const patchResult = computePatchFromContents(
      oldContent,
      newContent,
      aPath,
      delta.path,
      null,
      null,
      delta.oldId === ZERO_OID ? null : delta.oldId,
      delta.newId === ZERO_OID ? null : delta.newId,
      delta.status === "renamed",
    );
    return {
      patchText: patchResult.patchText || null,
      additions: patchResult.additions,
      deletions: patchResult.deletions,
    };
  } catch {
    return { patchText: null, additions: 0, deletions: 0 };
  }
};

const buildBaseTree = (r: OpenRepo, baseRef: string) => {
  try {
    return r.repo.getTree(baseRef);
  } catch {
    try {
      const baseOid = r.repo.revparseSingle(baseRef);
      const obj = r.repo.findObject(baseOid);
      if (!obj) return null;
      if (obj.type() === "Tree") {
        return obj as unknown as ReturnType<OpenRepo["repo"]["getTree"]>;
      }
      const commit = r.repo.getCommit(baseOid);
      return commit.tree();
    } catch {
      return null;
    }
  }
};

// One full diff pass for `(cwd)` against `baseRef`: walks the tree diff, runs
// rename detection, then builds per-file metadata + patch text in a single
// loop (one jsdiff per file, used for both counts and patch — the old code
// ran jsdiff twice per file). Untracked files are folded in from the working
// tree with synthesized patches. Yields to the event loop between batches so a
// large branch diff never blocks the WS terminal during this one pass.
const buildDiffCache = async (r: OpenRepo, baseRef: string): Promise<DiffCache | null> => {
  const baseTree = buildBaseTree(r, baseRef);
  if (!baseTree) return null;

  let diff;
  try {
    diff = r.repo.diffTreeToWorkdirWithIndex(baseTree);
  } catch {
    return null;
  }

  try {
    diff.findSimilar({ renames: true });
  } catch {
    // Rename detection failed
  }

  // Prime libgit2's lazy per-delta binary flag: DiffFile.isBinary() returns
  // false until the diff's stats have been materialized, which loads content
  // and sniffs for NUL bytes. Without this, binary files read as text and get
  // a junk patch synthesized from utf8-decoded blob bytes.
  void diff.stats();

  const deltaInfos = collectDeltaInfos(diff);
  const untracked = await collectUntrackedFiles(r);

  const fileMeta: GitDiffFileMeta[] = [];
  const filePatchByPath = new Map<string, string | null>();
  const fileBinaryByPath = new Map<string, boolean>();
  const filePatchOmittedByPath = new Map<string, boolean>();

  let totalPatchBytes = 0;
  let additions = 0;
  let deletions = 0;
  let binaries = 0;

  const YIELD_EVERY = 200;
  for (let index = 0; index < deltaInfos.length; index += 1) {
    if (index > 0 && index % YIELD_EVERY === 0) await yieldToEventLoop();
    const delta = deltaInfos[index];

    let patchText: string | null = null;
    let patchOmitted = false;
    let fileAdditions: number;
    let fileDeletions: number;

    if (delta.binary) {
      fileAdditions = 0;
      fileDeletions = 0;
      binaries += 1;
    } else {
      const patchResult = buildDeltaPatch(r, delta);
      fileAdditions = patchResult.additions;
      fileDeletions = patchResult.deletions;
      patchText = patchResult.patchText;

      if (patchText !== null) {
        if (
          patchText.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
          totalPatchBytes + patchText.length > GIT_MAX_TOTAL_PATCH_BYTES
        ) {
          patchText = null;
          patchOmitted = true;
        } else {
          totalPatchBytes += patchText.length;
        }
      } else {
        patchOmitted = true;
      }
    }

    additions += fileAdditions;
    deletions += fileDeletions;

    fileMeta.push({
      path: delta.path,
      oldPath: delta.oldPath,
      status: delta.status,
      additions: fileAdditions,
      deletions: fileDeletions,
      binary: delta.binary,
    });
    filePatchByPath.set(delta.path, patchText);
    fileBinaryByPath.set(delta.path, delta.binary);
    filePatchOmittedByPath.set(delta.path, patchOmitted);
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
    branch: getCurrentBranch(r),
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

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const ensureDiffCache = async (r: OpenRepo, options: GitDiffOptions): Promise<DiffCache | null> => {
  // Read the cache before resolving the base ref — that resolution does
  // libgit2 work (revparseSingle + getMergeBase) on every call, so for the
  // per-file patch endpoint (where the cache is warm on nearly every
  // request) checking first keeps it a pure map lookup.
  const cached = readDiffCache(r.cwd, options.mode, options.base ?? null);
  if (cached) return cached;

  const baseRef = resolveEffectiveBaseRef(r, options);
  if (baseRef === null) return null;

  const cache = await buildDiffCache(r, baseRef);
  if (cache) writeDiffCache(r.cwd, options.mode, options.base ?? null, cache);
  return cache;
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

export const getGitDiffSummary = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffSummary> => {
  const r = await openRepo(cwd);
  if (!r) return EMPTY_SUMMARY;

  // Summary is pushed on every git-dirty signal (per-keystroke during edits),
  // so it must stay cheap even when the full diff cache is cold. Read only the
  // aggregate stats from the tree diff — no per-file jsdiff — unless a cache
  // is already warm, in which case reuse its per-file summary.
  const cached = readDiffCache(r.cwd, options.mode, options.base ?? null);
  if (cached) return cached.summary;

  try {
    const baseRef = resolveEffectiveBaseRef(r, options);
    if (baseRef === null) return { ...EMPTY_SUMMARY, isRepo: true };
    const branch = getCurrentBranch(r);

    const baseTree = buildBaseTree(r, baseRef);
    if (!baseTree) return { ...EMPTY_SUMMARY, isRepo: true };

    let diff;
    try {
      diff = r.repo.diffTreeToWorkdirWithIndex(baseTree);
    } catch {
      return { ...EMPTY_SUMMARY, isRepo: true };
    }

    try {
      diff.findSimilar({ renames: true });
    } catch {
      // Rename detection failed
    }

    const stats = diff.stats();
    let additions = Number(stats.insertions);
    let deletions = Number(stats.deletions);
    let binaries = 0;
    let fileCount = Number(stats.filesChanged);

    const diffDeltas = collectIterator<{
      status: () => string;
      newFile: () => { isBinary: () => boolean };
    }>(diff.deltas());
    for (const delta of diffDeltas) {
      if (deltaTypeToStatus(delta.status()) !== "untracked" && delta.newFile().isBinary()) {
        binaries++;
      }
    }

    const untracked = await collectUntrackedFiles(r);
    for (const file of untracked) {
      fileCount++;
      if (file.binary) {
        binaries++;
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
  const r = await openRepo(cwd);
  if (!r) return { isRepo: false, files: [] };

  const cache = await ensureDiffCache(r, options);
  if (!cache) return { isRepo: true, files: [] };

  const files: GitDiffFile[] = cache.fileMeta.map((meta) => ({
    path: meta.path,
    oldPath: meta.oldPath,
    status: meta.status,
    additions: meta.additions,
    deletions: meta.deletions,
    binary: meta.binary,
    patch: cache.filePatchByPath.get(meta.path) ?? null,
    patchOmitted: cache.filePatchOmittedByPath.get(meta.path) ?? false,
  }));

  return { isRepo: true, files };
};

export const getGitDiffFiles = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFileListResponse> => {
  const r = await openRepo(cwd);
  if (!r) return { isRepo: false, files: [] };

  const cache = await ensureDiffCache(r, options);
  if (!cache) return { isRepo: true, files: [] };

  return { isRepo: true, files: cache.fileMeta };
};

export const getGitDiffFilePatch = async (
  cwd: string,
  requestedPath: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  const r = await openRepo(cwd);
  if (!r) return empty;

  const cache = await ensureDiffCache(r, options);
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
  return getGitDiffFilePatchFromWorkingTree(r, requestedPath);
};

const getGitDiffFilePatchFromWorkingTree = async (
  r: OpenRepo,
  requestedPath: string,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  const absolutePath = path.join(r.cwd, requestedPath);
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

type ParsedPr = GitBranchPr & { headOwner: string | null };

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

const parseGithubRemotes = (r: OpenRepo): GithubRemote[] => {
  const raw: GithubRemote[] = [];

  try {
    for (const remoteName of r.repo.remoteNames()) {
      try {
        const remote = r.repo.getRemote(remoteName);
        const url = remote.url();
        const match = /github\.com[/:]([^\s/]+)\/([^\s]+?)(?:\.git)?$/i.exec(url);
        if (!match) continue;
        const [, owner, repoName] = match;
        raw.push({ name: remoteName, slug: `${owner}/${repoName}`, owner });
      } catch {
        continue;
      }
    }
  } catch {
    // No remotes
  }

  return memoBy(raw, (remote) => `${remote.name} ${remote.slug}`);
};

const detectPr = async (r: OpenRepo): Promise<GitBranchPr | null> => {
  const currentBranch = getCurrentBranch(r);
  if (!currentBranch) return null;
  const remotes = parseGithubRemotes(r);
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
  if (openPr) {
    return {
      number: openPr.number,
      title: openPr.title,
      baseRefName: openPr.baseRefName,
      url: openPr.url,
      state: openPr.state,
    };
  }
  const fallback = candidates[0];
  return fallback
    ? {
        number: fallback.number,
        title: fallback.title,
        baseRefName: fallback.baseRefName,
        url: fallback.url,
        state: fallback.state,
      }
    : null;
};

export const listGithubRemoteSlugs = async (cwd: string): Promise<string[]> => {
  const r = await openRepo(cwd);
  if (!r) return [];
  const remotes = parseGithubRemotes(r);
  return memoBy(remotes, (remote) => remote.slug).map((remote) => remote.slug);
};

export const getGitBranchInfo = async (cwd: string): Promise<GitBranchInfo> => {
  const r = await openRepo(cwd);
  if (!r) {
    return {
      isRepo: false,
      currentBranch: null,
      defaultBase: null,
      defaultBaseSource: null,
      branches: [],
      pr: null,
    };
  }

  const currentBranch = getCurrentBranch(r);
  const defaultBase = resolveDefaultBase(r);

  const branchEntries = collectIterator<{ name: string; type: string }>(r.repo.branches());
  const branchData: Array<{ name: string; time: number }> = [];
  for (const b of branchEntries) {
    if (b.name.endsWith("/HEAD")) continue;
    try {
      const refName = b.type === "Remote" ? `refs/remotes/${b.name}` : `refs/heads/${b.name}`;
      const ref = r.repo.getReference(refName);
      const target = ref.target();
      if (!target) continue;
      const commit = r.repo.getCommit(target);
      branchData.push({ name: b.name, time: commit.time().getTime() });
    } catch {
      branchData.push({ name: b.name, time: 0 });
    }
    if (branchData.length >= GIT_MAX_BRANCHES) break;
  }
  branchData.sort((a, b) => b.time - a.time);

  return {
    isRepo: true,
    currentBranch,
    defaultBase: defaultBase?.ref ?? null,
    defaultBaseSource: defaultBase?.source ?? null,
    branches: branchData.map((b) => b.name),
    pr: null,
  };
};

export const getGitBranchPr = async (cwd: string): Promise<GitBranchPr | null> => {
  const r = await openRepo(cwd);
  if (!r) return null;
  return detectPr(r);
};
