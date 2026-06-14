import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openRepository } from "es-git";
import {
  GH_COMMAND_TIMEOUT_MS,
  GIT_BINARY_SNIFF_BYTES,
  GIT_COMMAND_TIMEOUT_MS,
  GIT_MAX_BRANCHES,
  GIT_MAX_OUTPUT_BYTES,
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

const collectIterator = <T>(iterable: unknown): T[] => {
  const result: T[] = [];
  for (const item of iterable as Iterable<T>) result.push(item);
  return result;
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

const runGh = (cwd: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      "gh",
      args,
      { cwd, timeout: GH_COMMAND_TIMEOUT_MS, maxBuffer: GIT_MAX_OUTPUT_BYTES, encoding: "utf8" },
      (error, stdout) => resolve(error ? null : stdout),
    );
  });

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

const collectUntrackedFiles = (r: OpenRepo): UntrackedFile[] => {
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
      const stat = fs.statSync(absolutePath);
      if (!stat.isFile()) continue;
      const bytesToRead = Math.min(stat.size, GIT_MAX_UNTRACKED_FILE_BYTES);
      const buffer = Buffer.alloc(bytesToRead);
      const handle = fs.openSync(absolutePath, "r");
      fs.readSync(handle, buffer, 0, bytesToRead, 0);
      fs.closeSync(handle);
      const sniffEnd = Math.min(buffer.length, GIT_BINARY_SNIFF_BYTES);
      const binary = buffer.subarray(0, sniffEnd).includes(0);
      const truncated = stat.size > GIT_MAX_UNTRACKED_FILE_BYTES;
      const content = binary ? null : truncated ? null : buffer.toString("utf8");
      const lines = binary ? 0 : content ? countLines(content) : 0;
      files.push({ path: filePath, binary, lines, content, truncated });
    } catch {
      continue;
    }
  }
  return files;
};

export const splitPatchByFile = (raw: string): string[] =>
  raw.split(/^(?=diff --git )/m).filter((chunk) => chunk.startsWith("diff --git "));

export const buildUntrackedPatch = (content: string): string => {
  if (content.length === 0) return "";
  const hasTrailingNewline = content.endsWith("\n");
  const lines = content.split("\n");
  if (hasTrailingNewline) lines.pop();
  const body = lines.map((line) => `+${line}`).join("\n");
  const noNewlineMarker = hasTrailingNewline ? "" : "\n\\ No newline at end of file";
  return `@@ -0,0 +1,${lines.length} @@\n${body}${noNewlineMarker}\n`;
};

interface TrackedDelta {
  path: string;
  oldPath: string | null;
  status: GitDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
}

const computeTrackedDeltas = async (r: OpenRepo, baseRef: string): Promise<TrackedDelta[]> => {
  let baseTree;
  try {
    baseTree = r.repo.getTree(baseRef);
  } catch {
    try {
      const baseOid = r.repo.revparseSingle(baseRef);
      const obj = r.repo.findObject(baseOid);
      if (!obj) return [];
      if (obj.type() === "Tree") {
        baseTree = obj as unknown as ReturnType<OpenRepo["repo"]["getTree"]>;
      } else {
        const commit = r.repo.getCommit(baseOid);
        baseTree = commit.tree();
      }
    } catch {
      return [];
    }
  }

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

  const stats = diff.stats();
  const totalInsertions = Number(stats.insertions);
  const totalDeletions = Number(stats.deletions);

  const deltas = collectIterator<{
    status: () => string;
    newFile: () => { path: () => string; isBinary: () => boolean };
    oldFile: () => { path: () => string };
  }>(diff.deltas());

  const trackedDeltas: TrackedDelta[] = [];
  for (const delta of deltas) {
    const status = deltaTypeToStatus(delta.status());
    if (status === "untracked") continue;

    trackedDeltas.push({
      path: delta.newFile().path(),
      oldPath: status === "renamed" ? delta.oldFile().path() : null,
      status,
      additions: 0,
      deletions: 0,
      binary: delta.newFile().isBinary(),
    });
  }

  // Redistribute the stats diff-wide totals across deltas using git diff --numstat.
  // es-git's DiffStats gives aggregate insertions/deletions but not per-file.
  // We fall back to `git diff --numstat -z` for per-file counts — one subprocess
  // instead of the previous six, and only for the stat-heavy code paths.
  if (trackedDeltas.length > 0) {
    try {
      const numstatRaw = await runGit(r.cwd, [
        "diff",
        baseRef,
        "-M",
        "--no-ext-diff",
        "--no-textconv",
        "--numstat",
        "-z",
      ]);
      const entries = parseNumstatZ(numstatRaw);
      const numstatByPath = new Map(entries.map((e) => [e.path, e] as const));
      for (const d of trackedDeltas) {
        const entry = numstatByPath.get(d.path);
        if (entry && !d.binary) {
          d.additions = entry.additions;
          d.deletions = entry.deletions;
        }
      }
    } catch {
      // Fallback: split aggregate stats across files
      const nonBinary = trackedDeltas.filter((d) => !d.binary);
      if (nonBinary.length === 1) {
        nonBinary[0].additions = totalInsertions;
        nonBinary[0].deletions = totalDeletions;
      } else if (nonBinary.length > 0) {
        const perFileAdd = Math.floor(totalInsertions / nonBinary.length);
        let extraAdd = totalInsertions - perFileAdd * nonBinary.length;
        const perFileDel = Math.floor(totalDeletions / nonBinary.length);
        let extraDel = totalDeletions - perFileDel * nonBinary.length;
        for (const d of nonBinary) {
          d.additions = perFileAdd + (extraAdd > 0 ? 1 : 0);
          d.deletions = perFileDel + (extraDel > 0 ? 1 : 0);
          if (extraAdd > 0) extraAdd--;
          if (extraDel > 0) extraDel--;
        }
      }
    }
  }

  return trackedDeltas;
};

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

  try {
    const baseRef = resolveEffectiveBaseRef(r, options);
    if (baseRef === null) return { ...EMPTY_SUMMARY, isRepo: true };
    const branch = getCurrentBranch(r);

    let baseTree;
    try {
      baseTree = r.repo.getTree(baseRef);
    } catch {
      try {
        const baseOid = r.repo.revparseSingle(baseRef);
        const obj = r.repo.findObject(baseOid);
        if (!obj) return { ...EMPTY_SUMMARY, isRepo: true };
        if (obj.type() === "Tree") {
          baseTree = obj as unknown as ReturnType<OpenRepo["repo"]["getTree"]>;
        } else {
          const commit = r.repo.getCommit(baseOid);
          baseTree = commit.tree();
        }
      } catch {
        return { ...EMPTY_SUMMARY, isRepo: true };
      }
    }

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

    const untracked = collectUntrackedFiles(r);
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

export const getGitDiff = async (
  cwd: string,
  options: GitDiffOptions = WORKING_OPTIONS,
): Promise<GitDiffResponse> => {
  const r = await openRepo(cwd);
  if (!r) return { isRepo: false, files: [] };

  const baseRef = resolveEffectiveBaseRef(r, options);
  if (baseRef === null) return { isRepo: true, files: [] };

  const trackedDeltas = await computeTrackedDeltas(r, baseRef);

  // Patch text via subprocess — es-git's print() doesn't emit +/- line markers.
  let patchChunks: string[] | null = null;
  try {
    const patchRaw = await runGit(cwd, [
      "diff",
      baseRef,
      "-M",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--patch",
    ]);
    const chunks = splitPatchByFile(patchRaw);
    if (chunks.length === trackedDeltas.length) patchChunks = chunks;
  } catch {
    patchChunks = null;
  }

  let totalPatchBytes = 0;
  const files: GitDiffFile[] = trackedDeltas.map((entry, index) => {
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
      status: entry.status,
      additions: entry.additions,
      deletions: entry.deletions,
      binary: entry.binary,
      patch,
      patchOmitted,
    };
  });

  const untracked = collectUntrackedFiles(r);
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

  const untracked = collectUntrackedFiles(r);
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

  // Check if tracked
  const trackedDeltas = await computeTrackedDeltas(r, baseRef);
  const entry = trackedDeltas.find((d) => d.path === requestedPath);
  if (entry) {
    if (entry.binary) return { patch: null, patchOmitted: false, binary: true };

    // A rename must diff BOTH endpoints so -M pairs them into one chunk.
    const pathspecs = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    try {
      const raw = await runGit(r.cwd, [
        "diff",
        baseRef,
        "-M",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--patch",
        "--",
        ...pathspecs,
      ]);
      const chunk = pickPatchChunk(splitPatchByFile(raw), entry.path);
      if (chunk === null) return empty;
      if (chunk.length > GIT_MAX_PATCH_BYTES_PER_FILE) {
        return { patch: null, patchOmitted: true, binary: false };
      }
      return { patch: chunk, patchOmitted: false, binary: false };
    } catch {
      return { patch: null, patchOmitted: true, binary: false };
    }
  }

  // Not tracked — check if it's an untracked file
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

const normalizePrState = (raw: unknown): GitBranchPrState =>
  raw === "MERGED" ? "merged" : raw === "CLOSED" ? "closed" : "open";

type ParsedPr = GitBranchPr & { headOwner: string | null };

const parsePrList = (stdout: string | null): ParsedPr[] => {
  if (!stdout) return [];
  try {
    const parsed = JSON.parse(stdout) as Array<{
      number?: number;
      title?: string;
      baseRefName?: string;
      url?: string;
      state?: string;
      headRepositoryOwner?: { login?: string } | null;
    }>;
    if (!Array.isArray(parsed)) return [];
    const prs: ParsedPr[] = [];
    for (const item of parsed) {
      if (typeof item?.number !== "number" || !item.baseRefName) continue;
      prs.push({
        number: item.number,
        title: typeof item.title === "string" ? item.title : "",
        baseRefName: item.baseRefName,
        url: typeof item.url === "string" && item.url.length > 0 ? item.url : null,
        state: normalizePrState(item.state),
        headOwner:
          typeof item.headRepositoryOwner?.login === "string"
            ? item.headRepositoryOwner.login
            : null,
      });
    }
    return prs;
  } catch {
    return [];
  }
};

const PR_LIST_FIELDS = "number,title,baseRefName,url,state,headRepositoryOwner";

interface GithubRemote {
  name: string;
  slug: string;
  owner: string;
}

const parseGithubRemotes = (r: OpenRepo): GithubRemote[] => {
  const seen = new Set<string>();
  const remotes: GithubRemote[] = [];

  try {
    for (const remoteName of r.repo.remoteNames()) {
      try {
        const remote = r.repo.getRemote(remoteName);
        const url = remote.url();
        const match = /github\.com[/:]([^\s/]+)\/([^\s]+?)(?:\.git)?$/i.exec(url);
        if (!match) continue;
        const [, owner, repoName] = match;
        const slug = `${owner}/${repoName}`;
        const key = `${remoteName} ${slug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        remotes.push({ name: remoteName, slug, owner });
      } catch {
        continue;
      }
    }
  } catch {
    // No remotes
  }

  return remotes;
};

const detectPr = async (cwd: string, r: OpenRepo): Promise<GitBranchPr | null> => {
  const currentBranch = getCurrentBranch(r);
  if (!currentBranch) return null;
  const remotes = parseGithubRemotes(r);
  if (remotes.length === 0) return null;
  const ownRemote = remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  const ownOwner = ownRemote.owner.toLowerCase();
  const slugs = [...new Set(remotes.map((remote) => remote.slug))];

  const results = await Promise.all(
    slugs.map((slug) =>
      runGh(cwd, [
        "pr",
        "list",
        "--repo",
        slug,
        "--head",
        currentBranch,
        "--state",
        "all",
        "--json",
        PR_LIST_FIELDS,
        "--limit",
        "30",
      ]).then(parsePrList),
    ),
  );

  const seen = new Set<string>();
  let fallback: ParsedPr | null = null;
  for (const prs of results) {
    for (const pr of prs) {
      if (!pr.headOwner || pr.headOwner.toLowerCase() !== ownOwner) continue;
      const key = pr.url ?? `#${pr.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (pr.state === "open") {
        return {
          number: pr.number,
          title: pr.title,
          baseRefName: pr.baseRefName,
          url: pr.url,
          state: pr.state,
        };
      }
      fallback ??= pr;
    }
  }
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
  const slugs: string[] = [];
  for (const remote of remotes) {
    if (!slugs.includes(remote.slug)) slugs.push(remote.slug);
  }
  return slugs;
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
  const pr = await detectPr(cwd, r);
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
