import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  GIT_BINARY_SNIFF_BYTES,
  GIT_COMMAND_TIMEOUT_MS,
  GIT_EMPTY_TREE_HASH,
  GIT_MAX_OUTPUT_BYTES,
  GIT_MAX_PATCH_BYTES_PER_FILE,
  GIT_MAX_TOTAL_PATCH_BYTES,
  GIT_MAX_UNTRACKED_FILES,
  GIT_MAX_UNTRACKED_FILE_BYTES,
} from "./constants.js";
import type {
  GitDiffFile,
  GitDiffFileListResponse,
  GitDiffFileMeta,
  GitDiffFilePatch,
  GitDiffFileStatus,
  GitDiffResponse,
  GitDiffSummary,
} from "./types.js";

const EMPTY_SUMMARY: GitDiffSummary = {
  isRepo: false,
  files: 0,
  additions: 0,
  deletions: 0,
  binaries: 0,
};

const runGit = (cwd: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      ["--no-optional-locks", "-C", cwd, ...args],
      {
        timeout: GIT_COMMAND_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        encoding: "utf8",
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });

const isGitRepo = async (cwd: string): Promise<boolean> => {
  try {
    const stdout = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    // Not a repo, git not installed, or the command timed out — all of these
    // degrade to "nothing to diff" rather than an error the client must handle.
    return false;
  }
};

// Diff base for the working tree. HEAD when at least one commit exists;
// otherwise git's well-known empty tree, so staged files in a brand-new
// repository still show up.
const resolveDiffBase = async (cwd: string): Promise<string> => {
  try {
    await runGit(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    return "HEAD";
  } catch {
    return GIT_EMPTY_TREE_HASH;
  }
};

export interface NumstatEntry {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

/**
 * Parse `git diff --numstat -z` output. Entries are NUL-separated:
 *   `<added>\t<deleted>\t<path>` for ordinary changes, and
 *   `<added>\t<deleted>\t` followed by two extra NUL-separated tokens
 *   (old path, new path) for renames/copies. Binary files report `-` counts.
 */
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

/**
 * Parse `git diff --name-status -z` output into a path -> status map.
 * Tokens alternate `<status>` then path (or old path, new path for R/C).
 */
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

// Split `git diff --patch` output into one chunk per file. Chunk order matches
// the numstat/name-status order for the same diff arguments.
export const splitPatchByFile = (raw: string): string[] =>
  raw.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));

interface UntrackedFileContent {
  binary: boolean;
  lines: number;
  truncated: boolean;
  content: string | null;
}

const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  if (!text.endsWith("\n")) count += 1;
  return count;
};

const readUntrackedFile = async (filePath: string): Promise<UntrackedFileContent | null> => {
  let handle: fs.promises.FileHandle | null = null;
  try {
    handle = await fs.promises.open(filePath, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) return null;
    const bytesToRead = Math.min(stat.size, GIT_MAX_UNTRACKED_FILE_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, 0);
    const sniffEnd = Math.min(buffer.length, GIT_BINARY_SNIFF_BYTES);
    if (buffer.subarray(0, sniffEnd).includes(0)) {
      return { binary: true, lines: 0, truncated: false, content: null };
    }
    const truncated = stat.size > GIT_MAX_UNTRACKED_FILE_BYTES;
    const text = buffer.toString("utf8");
    return { binary: false, lines: countLines(text), truncated, content: truncated ? null : text };
  } catch {
    // Vanished, unreadable, or special file — skip it.
    return null;
  } finally {
    await handle?.close();
  }
};

// Untracked-file line counts are recomputed on every summary poll; cache them
// by size+mtime so steady-state polls only stat each file. Bounded to avoid
// growing forever across many repos/sessions.
const UNTRACKED_CACHE_MAX_ENTRIES = 4096;
const untrackedStatsCache = new Map<string, { key: string; lines: number; binary: boolean }>();

const getUntrackedStats = async (
  filePath: string,
): Promise<{ lines: number; binary: boolean } | null> => {
  let cacheKey: string | null = null;
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile()) return null;
    cacheKey = `${stat.size}:${stat.mtimeMs}`;
    const cached = untrackedStatsCache.get(filePath);
    if (cached && cached.key === cacheKey) {
      return { lines: cached.lines, binary: cached.binary };
    }
  } catch {
    return null;
  }
  const read = await readUntrackedFile(filePath);
  if (!read) return null;
  if (untrackedStatsCache.size >= UNTRACKED_CACHE_MAX_ENTRIES) untrackedStatsCache.clear();
  untrackedStatsCache.set(filePath, { key: cacheKey, lines: read.lines, binary: read.binary });
  return { lines: read.lines, binary: read.binary };
};

const listUntrackedPaths = async (cwd: string): Promise<string[]> => {
  const stdout = await runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  return stdout.split("\0").filter((entry) => entry.length > 0);
};

export const getGitDiffSummary = async (cwd: string): Promise<GitDiffSummary> => {
  if (!(await isGitRepo(cwd))) return EMPTY_SUMMARY;
  try {
    const base = await resolveDiffBase(cwd);
    const [numstatRaw, untrackedPaths] = await Promise.all([
      runGit(cwd, ["diff", base, "-M", "--no-ext-diff", "--no-textconv", "--numstat", "-z"]),
      listUntrackedPaths(cwd),
    ]);
    const tracked = parseNumstatZ(numstatRaw);
    let additions = 0;
    let deletions = 0;
    let binaries = 0;
    for (const entry of tracked) {
      additions += entry.additions;
      deletions += entry.deletions;
      if (entry.binary) binaries += 1;
    }
    for (const relativePath of untrackedPaths.slice(0, GIT_MAX_UNTRACKED_FILES)) {
      const stats = await getUntrackedStats(path.join(cwd, relativePath));
      if (!stats) continue;
      if (stats.binary) binaries += 1;
      else additions += stats.lines;
    }
    return {
      isRepo: true,
      files: tracked.length + untrackedPaths.length,
      additions,
      deletions,
      binaries,
    };
  } catch {
    // Transient git failure (lock contention, timeout) — report a quiet repo
    // rather than erroring the poll; the next poll will catch up.
    return { ...EMPTY_SUMMARY, isRepo: true };
  }
};

// Synthesize a single-hunk unified diff for an untracked (new) file so the
// client renders it exactly like a tracked added file.
export const buildUntrackedPatch = (content: string): string => {
  if (content.length === 0) return "";
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = hasTrailingNewline ? "" : "\n\\ No newline at end of file";
  return `@@ -0,0 +1,${lines.length} @@\n${body}${noNewlineMarker}\n`;
};

const buildUntrackedDiffFile = async (
  cwd: string,
  relativePath: string,
): Promise<GitDiffFile | null> => {
  const read = await readUntrackedFile(path.join(cwd, relativePath));
  if (!read) return null;
  if (read.binary) {
    return {
      path: relativePath,
      oldPath: null,
      status: "untracked",
      additions: 0,
      deletions: 0,
      binary: true,
      patch: null,
      patchOmitted: false,
    };
  }
  return {
    path: relativePath,
    oldPath: null,
    status: "untracked",
    additions: read.lines,
    deletions: 0,
    binary: false,
    patch: read.truncated || read.content === null ? null : buildUntrackedPatch(read.content),
    patchOmitted: read.truncated,
  };
};

// Collect per-file metadata (counts, rename old paths, status letters) without
// generating any patch text. Shared by the bulk diff, the file-list endpoint,
// and the per-file patch fetch. Rejects propagate to the caller's try/catch.
const collectTrackedMeta = async (
  cwd: string,
  base: string,
): Promise<{ tracked: NumstatEntry[]; statuses: Map<string, GitDiffFileStatus> }> => {
  const [numstatRaw, nameStatusRaw] = await Promise.all([
    runGit(cwd, ["diff", base, "-M", "--no-ext-diff", "--no-textconv", "--numstat", "-z"]),
    runGit(cwd, ["diff", base, "-M", "--no-ext-diff", "--no-textconv", "--name-status", "-z"]),
  ]);
  return { tracked: parseNumstatZ(numstatRaw), statuses: parseNameStatusZ(nameStatusRaw) };
};

const resolveFileStatus = (
  entry: NumstatEntry,
  statuses: Map<string, GitDiffFileStatus>,
): GitDiffFileStatus => statuses.get(entry.path) ?? (entry.oldPath ? "renamed" : "modified");

// Select the patch chunk whose new-side path matches the requested file. Our
// per-file diff normally yields exactly one chunk; an odd worktree state can
// split it, and we'd rather show nothing than attach the wrong file's patch.
const pickPatchChunk = (chunks: string[], newPath: string): string | null => {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0];
  return (
    chunks.find(
      (chunk) =>
        chunk.includes(`\n+++ b/${newPath}\n`) || chunk.includes(`\nrename to ${newPath}\n`),
    ) ?? null
  );
};

export const getGitDiff = async (cwd: string): Promise<GitDiffResponse> => {
  if (!(await isGitRepo(cwd))) return { isRepo: false, files: [] };

  const base = await resolveDiffBase(cwd);
  let tracked: NumstatEntry[] = [];
  let statuses = new Map<string, GitDiffFileStatus>();
  try {
    ({ tracked, statuses } = await collectTrackedMeta(cwd, base));
  } catch {
    return { isRepo: true, files: [] };
  }

  // The patch run can exceed maxBuffer or time out on huge diffs; degrade to
  // stats-only entries instead of failing the whole response.
  let patchChunks: string[] | null = null;
  try {
    const patchRaw = await runGit(cwd, [
      "diff",
      base,
      "-M",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--patch",
    ]);
    const chunks = splitPatchByFile(patchRaw);
    // Chunks pair with numstat entries by index; if the counts diverge
    // (unexpected git output) don't risk attaching the wrong patch to a file.
    if (chunks.length === tracked.length) patchChunks = chunks;
  } catch {
    patchChunks = null;
  }

  let totalPatchBytes = 0;
  const files: GitDiffFile[] = tracked.map((entry, index) => {
    const status = resolveFileStatus(entry, statuses);
    let patch: string | null = null;
    let patchOmitted = false;
    if (entry.binary) {
      patch = null;
    } else if (patchChunks === null) {
      patchOmitted = true;
    } else {
      const chunk = patchChunks[index] ?? "";
      if (
        chunk.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + chunk.length > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        patchOmitted = true;
      } else {
        patch = chunk;
        totalPatchBytes += chunk.length;
      }
    }
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      status,
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
      patch,
      patchOmitted,
    };
  });

  let untrackedPaths: string[] = [];
  try {
    untrackedPaths = await listUntrackedPaths(cwd);
  } catch {
    untrackedPaths = [];
  }
  for (const relativePath of untrackedPaths.slice(0, GIT_MAX_UNTRACKED_FILES)) {
    const file = await buildUntrackedDiffFile(cwd, relativePath);
    if (!file) continue;
    if (file.patch !== null) {
      if (
        file.patch.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + file.patch.length > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        file.patch = null;
        file.patchOmitted = true;
      } else {
        totalPatchBytes += file.patch.length;
      }
    }
    files.push(file);
  }

  return { isRepo: true, files };
};

// File list for the diff viewer: per-file metadata only, no patch bodies. Cheap
// (numstat + name-status + stat-only untracked) and small, so the viewer can
// render its sidebar and totals the instant it opens. Patches load on demand via
// getGitDiffFilePatch.
export const getGitDiffFiles = async (cwd: string): Promise<GitDiffFileListResponse> => {
  if (!(await isGitRepo(cwd))) return { isRepo: false, files: [] };

  const base = await resolveDiffBase(cwd);
  let tracked: NumstatEntry[] = [];
  let statuses = new Map<string, GitDiffFileStatus>();
  try {
    ({ tracked, statuses } = await collectTrackedMeta(cwd, base));
  } catch {
    return { isRepo: true, files: [] };
  }

  const files: GitDiffFileMeta[] = tracked.map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: resolveFileStatus(entry, statuses),
    additions: entry.additions,
    deletions: entry.deletions,
    binary: entry.binary,
  }));

  let untrackedPaths: string[] = [];
  try {
    untrackedPaths = await listUntrackedPaths(cwd);
  } catch {
    untrackedPaths = [];
  }
  for (const relativePath of untrackedPaths.slice(0, GIT_MAX_UNTRACKED_FILES)) {
    const stats = await getUntrackedStats(path.join(cwd, relativePath));
    if (!stats) continue;
    files.push({
      path: relativePath,
      oldPath: null,
      status: "untracked",
      additions: stats.binary ? 0 : stats.lines,
      deletions: 0,
      binary: stats.binary,
    });
  }

  return { isRepo: true, files };
};

// Unified diff for a SINGLE file, fetched on demand. Unlike getGitDiff this is
// NOT subject to the whole-response cap (GIT_MAX_TOTAL_PATCH_BYTES) — only the
// per-file cap applies — so a file the bulk endpoint dropped because the response
// total was exhausted still loads when opened individually.
export const getGitDiffFilePatch = async (
  cwd: string,
  requestedPath: string,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  if (!(await isGitRepo(cwd))) return empty;

  const base = await resolveDiffBase(cwd);
  let tracked: NumstatEntry[] = [];
  try {
    ({ tracked } = await collectTrackedMeta(cwd, base));
  } catch {
    return empty;
  }

  const entry = tracked.find((candidate) => candidate.path === requestedPath);
  if (entry) {
    if (entry.binary) return { patch: null, patchOmitted: false, binary: true };
    // A rename must diff BOTH endpoints so `-M` pairs them into one chunk;
    // diffing only the new path would report it as an addition.
    const pathspecs = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    let raw: string;
    try {
      raw = await runGit(cwd, [
        "diff",
        base,
        "-M",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--patch",
        "--",
        ...pathspecs,
      ]);
    } catch {
      // Timed out or exceeded maxBuffer on a single pathological file.
      return { patch: null, patchOmitted: true, binary: false };
    }
    const chunk = pickPatchChunk(splitPatchByFile(raw), entry.path);
    if (chunk === null) return empty;
    if (chunk.length > GIT_MAX_PATCH_BYTES_PER_FILE) {
      return { patch: null, patchOmitted: true, binary: false };
    }
    return { patch: chunk, patchOmitted: false, binary: false };
  }

  // Not tracked: it may be an untracked file (synthesize a patch like getGitDiff
  // does), otherwise it was committed/reverted since the file list was fetched.
  let untrackedPaths: string[] = [];
  try {
    untrackedPaths = await listUntrackedPaths(cwd);
  } catch {
    return empty;
  }
  if (!untrackedPaths.includes(requestedPath)) return empty;
  const file = await buildUntrackedDiffFile(cwd, requestedPath);
  if (!file) return empty;
  if (file.patch !== null && file.patch.length > GIT_MAX_PATCH_BYTES_PER_FILE) {
    return { patch: null, patchOmitted: true, binary: file.binary };
  }
  return { patch: file.patch, patchOmitted: file.patchOmitted, binary: file.binary };
};
