import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import { openRepository } from "es-git";
import { computePatchFromContents } from "./utils/compute-patch.js";
import { memoBy } from "./utils/memo-by.js";
import { resolveGithubToken } from "./utils/resolve-github-token.js";
import {
  GIT_BINARY_SNIFF_BYTES,
  GIT_BRANCH_INFO_PR_TIMEOUT_MS,
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

const GIT_EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

const ZERO_OID = "0000000000000000000000000000000000000000";

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

interface DeltaMeta {
  path: string;
  oldPath: string | null;
  status: GitDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  oldId: string;
  newId: string;
  isWorkingTree: boolean;
}

const collectDeltaMeta = (
  r: OpenRepo,
  diff: ReturnType<OpenRepo["repo"]["diffTreeToWorkdirWithIndex"]>,
  isWorkingTree: boolean,
): DeltaMeta[] => {
  const stats = diff.stats();
  const totalInsertions = Number(stats.insertions);
  const totalDeletions = Number(stats.deletions);

  const deltas = collectIterator<{
    status: () => string;
    newFile: () => { path: () => string; isBinary: () => boolean; id: () => string };
    oldFile: () => { path: () => string; id: () => string };
  }>(diff.deltas());

  const result: DeltaMeta[] = [];
  for (const delta of deltas) {
    const status = deltaTypeToStatus(delta.status());
    if (status === "untracked") continue;

    const newFile = delta.newFile();
    const oldFile = delta.oldFile();
    const isBinary = newFile.isBinary();

    result.push({
      path: newFile.path(),
      oldPath: status === "renamed" ? oldFile.path() : null,
      status,
      additions: 0,
      deletions: 0,
      binary: isBinary,
      oldId: oldFile.id(),
      newId: newFile.id(),
      isWorkingTree,
    });
  }

  // Compute per-file additions/deletions from patch text.
  // es-git's DiffStats only gives aggregate totals; we generate
  // patches per-delta and count +/- lines from the structured diff.
  const nonBinary = result.filter((d) => !d.binary);
  if (nonBinary.length === 0) return result;

  if (nonBinary.length === 1) {
    nonBinary[0].additions = totalInsertions;
    nonBinary[0].deletions = totalDeletions;
    return result;
  }

  // Compute per-file stats from patch text. Each delta gets its own
  // patch generated from old vs new content, giving exact counts.
  for (const d of result) {
    if (d.binary) continue;
    try {
      const oldContent =
        d.oldId === ZERO_OID || d.oldId === ""
          ? d.status === "added"
            ? null
            : readBlobContent(r, d.oldId)
          : readBlobContent(r, d.oldId);
      const newContent = d.isWorkingTree
        ? readWorkingTreeFile(r, d.path, GIT_MAX_TOTAL_PATCH_BYTES)
        : d.newId === ZERO_OID || d.newId === ""
          ? d.status === "deleted"
            ? null
            : readBlobContent(r, d.newId)
          : readBlobContent(r, d.newId);

      const aPath = d.oldPath ?? d.path;
      const patchResult = computePatchFromContents(
        oldContent,
        newContent,
        aPath,
        d.path,
        null,
        null,
        d.oldId === ZERO_OID ? null : d.oldId,
        d.newId === ZERO_OID ? null : d.newId,
        d.status === "renamed",
      );
      d.additions = patchResult.additions;
      d.deletions = patchResult.deletions;
    } catch {
      // Fallback: proportional split of aggregate totals
      const perFileAdd = Math.floor(totalInsertions / nonBinary.length);
      d.additions = perFileAdd;
      d.deletions = Math.floor(totalDeletions / nonBinary.length);
    }
  }

  // Verify totals match and redistribute remainder if needed
  let computedAdds = 0;
  let computedDels = 0;
  for (const d of result) {
    if (!d.binary) {
      computedAdds += d.additions;
      computedDels += d.deletions;
    }
  }
  const addDelta = totalInsertions - computedAdds;
  const delDelta = totalDeletions - computedDels;
  if (addDelta !== 0 || delDelta !== 0) {
    const sorted = result.filter((d) => !d.binary);
    let remainingAdd = addDelta;
    let remainingDel = delDelta;
    for (const d of sorted) {
      if (remainingAdd > 0) {
        d.additions += 1;
        remainingAdd -= 1;
      } else if (remainingAdd < 0) {
        d.additions -= 1;
        remainingAdd += 1;
      }
      if (remainingDel > 0) {
        d.deletions += 1;
        remainingDel -= 1;
      } else if (remainingDel < 0) {
        d.deletions -= 1;
        remainingDel += 1;
      }
      if (remainingAdd === 0 && remainingDel === 0) break;
    }
  }

  return result;
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

export const splitPatchByFile = (raw: string): string[] =>
  raw.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));

interface TrackedDelta {
  path: string;
  oldPath: string | null;
  status: GitDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

const computeTrackedDeltas = async (r: OpenRepo, baseRef: string): Promise<TrackedDelta[]> => {
  const baseTree = buildBaseTree(r, baseRef);
  if (!baseTree) return [];

  let diff;
  try {
    diff = r.repo.diffTreeToWorkdirWithIndex(baseTree);
  } catch {
    return [];
  }

  try {
    diff.findSimilar({ renames: true });
  } catch {
    // Rename detection failed
  }

  const deltaMeta = collectDeltaMeta(r, diff, true);
  return deltaMeta.map((d) => ({
    path: d.path,
    oldPath: d.oldPath,
    status: d.status,
    additions: d.additions,
    deletions: d.deletions,
    binary: d.binary,
  }));
};

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

export interface NumstatEntry {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

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

const buildFilePatch = (r: OpenRepo, delta: DeltaMeta): string | null => {
  if (delta.binary) return null;

  const oldContent =
    delta.status === "added"
      ? null
      : delta.isWorkingTree
        ? readBlobContent(r, delta.oldId)
        : readBlobContent(r, delta.oldId);
  const newContent =
    delta.status === "deleted"
      ? null
      : delta.isWorkingTree
        ? readWorkingTreeFile(r, delta.path, GIT_MAX_TOTAL_PATCH_BYTES)
        : delta.newId === ZERO_OID
          ? readWorkingTreeFile(r, delta.path, GIT_MAX_TOTAL_PATCH_BYTES)
          : readBlobContent(r, delta.newId);

  const aPath = delta.oldPath ?? delta.path;
  const result = computePatchFromContents(
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

  return result.patchText || null;
};

export const getGitDiff = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffResponse> => {
  const r = await openRepo(cwd);
  if (!r) return { isRepo: false, files: [] };

  const baseRef = resolveEffectiveBaseRef(r, options);
  if (baseRef === null) return { isRepo: true, files: [] };

  const baseTree = buildBaseTree(r, baseRef);
  if (!baseTree) return { isRepo: true, files: [] };

  let diff;
  try {
    diff = r.repo.diffTreeToWorkdirWithIndex(baseTree);
  } catch {
    return { isRepo: true, files: [] };
  }

  try {
    diff.findSimilar({ renames: true });
  } catch {
    // Rename detection failed
  }

  const deltaMeta = collectDeltaMeta(r, diff, true);

  let totalPatchBytes = 0;
  const files: GitDiffFile[] = deltaMeta.map((entry) => {
    let patch: string | null = null;
    let patchOmitted = false;
    if (entry.binary) {
      patch = null;
    } else {
      try {
        patch = buildFilePatch(r, entry);
      } catch {
        patchOmitted = true;
      }
      if (patch !== null) {
        if (
          patch.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
          totalPatchBytes + patch.length > GIT_MAX_TOTAL_PATCH_BYTES
        ) {
          patch = null;
          patchOmitted = true;
        } else {
          totalPatchBytes += patch.length;
        }
      } else if (!patchOmitted) {
        patchOmitted = true;
      }
    }
    return {
      path: entry.path,
      oldPath: entry.oldPath,
      status: entry.status,
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
      patch,
      patchOmitted,
    };
  });

  const untracked = await collectUntrackedFiles(r);
  for (const file of untracked) {
    const patch = file.binary
      ? null
      : file.truncated || file.content === null
        ? null
        : buildUntrackedPatch(file.content);

    const entry: GitDiffFile = {
      path: file.path,
      oldPath: null,
      status: "untracked",
      additions: file.binary ? 0 : file.lines,
      deletions: 0,
      binary: file.binary,
      patch,
      patchOmitted: file.truncated,
    };
    if (entry.patch !== null) {
      if (
        entry.patch.length > GIT_MAX_PATCH_BYTES_PER_FILE ||
        totalPatchBytes + entry.patch.length > GIT_MAX_TOTAL_PATCH_BYTES
      ) {
        entry.patch = null;
        entry.patchOmitted = true;
      } else {
        totalPatchBytes += entry.patch.length;
      }
    }
    files.push(entry);
  }

  return { isRepo: true, files };
};

export const getGitDiffFiles = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFileListResponse> => {
  const r = await openRepo(cwd);
  if (!r) return { isRepo: false, files: [] };

  const baseRef = resolveEffectiveBaseRef(r, options);
  if (baseRef === null) return { isRepo: true, files: [] };

  const trackedDeltas = await computeTrackedDeltas(r, baseRef);
  const files: GitDiffFileMeta[] = trackedDeltas.map((entry) => ({
    path: entry.path,
    oldPath: entry.oldPath,
    status: entry.status,
    additions: entry.additions,
    deletions: entry.deletions,
    binary: entry.binary,
  }));

  const untracked = await collectUntrackedFiles(r);
  for (const file of untracked) {
    files.push({
      path: file.path,
      oldPath: null,
      status: "untracked",
      additions: file.binary ? 0 : file.lines,
      deletions: 0,
      binary: file.binary,
    });
  }

  return { isRepo: true, files };
};

export const getGitDiffFilePatch = async (
  cwd: string,
  requestedPath: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffFilePatch> => {
  const empty: GitDiffFilePatch = { patch: null, patchOmitted: false, binary: false };
  const r = await openRepo(cwd);
  if (!r) return empty;

  const baseRef = resolveEffectiveBaseRef(r, options);
  if (baseRef === null) return empty;

  const baseTree = buildBaseTree(r, baseRef);
  if (!baseTree) return empty;

  let diff;
  try {
    diff = r.repo.diffTreeToWorkdirWithIndex(baseTree);
  } catch {
    return empty;
  }

  try {
    diff.findSimilar({ renames: true });
  } catch {
    // Rename detection failed
  }

  const deltaMeta = collectDeltaMeta(r, diff, true);
  const entry = deltaMeta.find((d) => d.path === requestedPath);
  if (entry) {
    if (entry.binary) return { patch: null, patchOmitted: false, binary: true };

    try {
      const patch = buildFilePatch(r, entry);
      if (patch === null) return empty;
      if (patch.length > GIT_MAX_PATCH_BYTES_PER_FILE) {
        return { patch: null, patchOmitted: true, binary: false };
      }
      return { patch, patchOmitted: false, binary: false };
    } catch {
      return { patch: null, patchOmitted: true, binary: false };
    }
  }

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
  const pr = await Promise.race([
    detectPr(r),
    new Promise<GitBranchPr | null>((resolve) =>
      setTimeout(() => resolve(null), GIT_BRANCH_INFO_PR_TIMEOUT_MS),
    ),
  ]);
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
    pr,
  };
};
