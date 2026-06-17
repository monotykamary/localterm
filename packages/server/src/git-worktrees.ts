import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGit } from "./utils/run-git.js";
import { generateWorktreeName } from "./utils/worktree-names.js";
import type { GitWorktree, GitWorktreeListResponse } from "./types.js";

// A user-facing git failure (path exists, branch checked out elsewhere, the
// main worktree can't be removed, …). The route catches this and surfaces
// `message` (git's own stderr) so the client can show something actionable
// instead of an opaque code.
export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorktreeError";
  }
}

const HOME = os.homedir();
const PATH_SEPARATOR = path.sep;
// Auto-created worktrees live under the localterm state dir (~/.localterm/),
// next to the daemon's other per-project state (automations.json, server.log).
const WORKTREES_PARENT_DIR = path.join(HOME, ".localterm", "worktrees");
// Marker file placed in each project folder so a second repo with the same
// project name (but a different main worktree path) gets its own folder instead
// of colliding with the first repo's worktrees.
const REPO_MARKER_FILENAME = ".localterm-repo-id";
const REPO_ID_HASH_LENGTH = 12;
const PROJECT_FOLDER_HASH_LENGTH = 6;
const MAX_PROJECT_FOLDER_ATTEMPTS = 100;
const MAX_WORKTREE_NAME_ATTEMPTS = 50;

// Tildify an absolute path against the daemon's home. The browser can't resolve
// the home dir itself, so the server does it for display strings (the absolute
// `path` is always sent back unchanged for actions like opening a shell).
const tildifyHome = (absolutePath: string): string => {
  const resolved = path.resolve(absolutePath);
  if (resolved === HOME) return "~";
  if (resolved.startsWith(`${HOME}${PATH_SEPARATOR}`)) return `~${resolved.slice(HOME.length)}`;
  return resolved;
};

// Stable per-repo identity: a short hash of the main worktree's absolute path.
// Two repos with the same project name but different paths get different ids, so
// their worktree folders don't collide.
const repoId = (mainRoot: string): string =>
  crypto.createHash("sha256").update(mainRoot).digest("hex").slice(0, REPO_ID_HASH_LENGTH);

const readRepoMarker = (dir: string): string | null => {
  try {
    const content = fs.readFileSync(path.join(dir, REPO_MARKER_FILENAME), "utf8").trim();
    return content || null;
  } catch {
    return null;
  }
};

const writeRepoMarker = (dir: string, id: string): void => {
  try {
    fs.writeFileSync(path.join(dir, REPO_MARKER_FILENAME), id);
  } catch {
    // A marker write failure isn't fatal — the folder still works; we just
    // can't disambiguate a future same-named repo.
  }
};

// Read-only resolution of the project folder NAME (for display). Mirrors
// ensureProjectFolder's logic without creating dirs or writing markers, so
// listGitWorktrees stays side-effect-free.
const resolveProjectFolderName = (projectName: string, id: string): string => {
  const preferred = path.join(WORKTREES_PARENT_DIR, projectName);
  if (!fs.existsSync(preferred)) return projectName;
  if (readRepoMarker(preferred) === id) return projectName;
  return `${projectName}-${id.slice(0, PROJECT_FOLDER_HASH_LENGTH)}`;
};

// Resolve + create the project folder, claiming it with the repo marker so a
// later same-named repo from a different path gets its own folder. Idempotent:
// re-uses an existing folder owned by this repo.
const ensureProjectFolder = (projectName: string, id: string): string => {
  const preferred = path.join(WORKTREES_PARENT_DIR, projectName);
  if (!fs.existsSync(preferred)) {
    fs.mkdirSync(preferred, { recursive: true });
    writeRepoMarker(preferred, id);
    return preferred;
  }
  if (readRepoMarker(preferred) === id) {
    writeRepoMarker(preferred, id);
    return preferred;
  }
  // Bare name is owned by a different repo. Fall back to a hashed name, then a
  // counter if even that is taken by a third repo (near-impossible at 6 hex).
  const hashedName = `${projectName}-${id.slice(0, PROJECT_FOLDER_HASH_LENGTH)}`;
  let candidate = path.join(WORKTREES_PARENT_DIR, hashedName);
  for (let attempt = 0; attempt < MAX_PROJECT_FOLDER_ATTEMPTS; attempt++) {
    if (!fs.existsSync(candidate)) {
      fs.mkdirSync(candidate, { recursive: true });
      writeRepoMarker(candidate, id);
      return candidate;
    }
    if (readRepoMarker(candidate) === id) {
      writeRepoMarker(candidate, id);
      return candidate;
    }
    candidate = path.join(WORKTREES_PARENT_DIR, `${hashedName}-${attempt + 2}`);
  }
  throw new WorktreeError("couldn't find a free project folder");
};

interface ParsedWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

const isGitRepo = async (cwd: string): Promise<boolean> => {
  const result = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0;
};

// The worktree the caller's cwd lives in (its toplevel root), so the matching
// entry can be flagged `isCurrent`. Cheaper than asking git to mark it: a single
// rev-parse vs a porcelain walk that already happened.
const currentWorktreeRoot = async (cwd: string): Promise<string | null> => {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  if (result.exitCode !== 0) return null;
  const root = result.stdout.toString("utf8").trim();
  return root || null;
};

// The main worktree's root — the parent of the shared common .git dir. Stable
// across linked worktrees (they all share it), so the derived project name and
// repo id don't depend on which worktree the caller's cwd happens to be in: a
// worktree created from inside a linked worktree still lands under the repo's
// own project folder. Resolved through realpath so it matches the paths git
// prints in `worktree list --porcelain` (git resolves symlinks; a naive
// path.resolve against a symlinked cwd would not).
const mainWorktreeRoot = async (cwd: string): Promise<string | null> => {
  const result = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
  if (result.exitCode !== 0) return null;
  const commonDir = result.stdout.toString("utf8").trim();
  if (!commonDir) return null;
  const root = path.dirname(path.resolve(cwd, commonDir));
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
};

// `git worktree list --porcelain` emits one block per worktree, fields on their
// own lines, blocks separated by a blank line:
//
//   worktree /abs/path/to/main
//   HEAD <sha>
//   branch refs/heads/main
//
//   worktree /abs/path/to/feature
//   HEAD <sha>
//   detached
//   locked
//   prunable
//
// The leading "worktree" line carries the path; HEAD/branch/detached/locked/
// prunable are optional flags. Parse defensively: unknown fields are ignored
// so future git output doesn't break the list.
const parseWorktreePorcelain = (raw: string): ParsedWorktree[] => {
  const entries: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;
  for (const line of raw.split("\n")) {
    if (line === "") {
      if (current) {
        entries.push(current);
        current = null;
      }
      continue;
    }
    const spaceIndex = line.indexOf(" ");
    const field = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1);
    if (field === "worktree") {
      current = {
        path: value,
        head: null,
        branch: null,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (!current) continue;
    if (field === "HEAD") {
      current.head = value || null;
    } else if (field === "branch") {
      // refs/heads/<name> -> <name>. Keep the raw value if it isn't a ref
      // (it never is in porcelain output, but be tolerant).
      current.branch = value.startsWith("refs/heads/")
        ? value.slice("refs/heads/".length)
        : value || null;
    } else if (field === "detached") {
      current.detached = true;
    } else if (field === "locked") {
      current.locked = true;
    } else if (field === "prunable") {
      current.prunable = true;
    }
  }
  if (current) entries.push(current);
  return entries;
};

const toWorktree = (
  parsed: ParsedWorktree,
  currentRoot: string | null,
  mainRoot: string | null,
): GitWorktree => ({
  path: parsed.path,
  displayPath: tildifyHome(parsed.path),
  branch: parsed.detached ? null : parsed.branch,
  head: parsed.head,
  isCurrent: currentRoot !== null && path.resolve(parsed.path) === path.resolve(currentRoot),
  isMain: mainRoot !== null && path.resolve(parsed.path) === path.resolve(mainRoot),
  isLocked: parsed.locked,
  isPrunable: parsed.prunable,
});

export const listGitWorktrees = async (cwd: string): Promise<GitWorktreeListResponse> => {
  if (!(await isGitRepo(cwd))) return { isRepo: false, worktrees: [], displayBaseDir: null };
  const [listResult, currentRoot, mainRoot] = await Promise.all([
    runGit(cwd, ["worktree", "list", "--porcelain"]),
    currentWorktreeRoot(cwd),
    mainWorktreeRoot(cwd),
  ]);
  if (listResult.exitCode !== 0) {
    throw new WorktreeError(listResult.stderr.trim() || "git worktree list failed");
  }
  const parsed = parseWorktreePorcelain(listResult.stdout.toString("utf8"));
  const worktrees = parsed.map((entry) => toWorktree(entry, currentRoot, mainRoot));
  let displayBaseDir: string | null = null;
  if (mainRoot) {
    const projectName = path.basename(mainRoot);
    if (projectName) {
      displayBaseDir = tildifyHome(
        path.join(WORKTREES_PARENT_DIR, resolveProjectFolderName(projectName, repoId(mainRoot))),
      );
    }
  }
  return { isRepo: true, worktrees, displayBaseDir };
};

// Create a worktree under ~/.localterm/worktrees/<project>/ on a memorable
// auto-generated branch (adjective-noun) from HEAD. The branch and folder name
// match, so the folder is self-describing. A collision (branch or folder
// already exists) retries with a fresh phrase; any other git failure is
// surfaced immediately.
export const createGitWorktree = async (cwd: string): Promise<{ path: string; branch: string }> => {
  const mainRoot = await mainWorktreeRoot(cwd);
  if (!mainRoot) throw new WorktreeError("couldn't resolve the repository's main worktree");
  const projectName = path.basename(mainRoot);
  if (!projectName) throw new WorktreeError("couldn't resolve the repository's project name");
  const projectDir = ensureProjectFolder(projectName, repoId(mainRoot));

  let lastError: WorktreeError | null = null;
  const attempted = new Set<string>();
  for (let attempt = 0; attempt < MAX_WORKTREE_NAME_ATTEMPTS; attempt++) {
    const name = generateWorktreeName(attempted);
    attempted.add(name);
    const targetPath = path.join(projectDir, name);
    const result = await runGit(cwd, ["worktree", "add", "-b", name, targetPath]);
    if (result.exitCode === 0) return { path: targetPath, branch: name };
    const stderr = result.stderr.trim();
    if (/already exists/i.test(stderr)) {
      lastError = new WorktreeError(stderr);
      continue;
    }
    throw new WorktreeError(stderr || "git worktree add failed");
  }
  throw lastError ?? new WorktreeError("couldn't find a free worktree name");
};

export const removeGitWorktree = async (cwd: string, targetPath: string): Promise<void> => {
  // The main worktree is never removable — not from itself, not from a linked
  // worktree. Guard server-side so a crafted DELETE can't try it (git itself
  // would also refuse, but this gives a clear message before spawning git).
  const mainRoot = await mainWorktreeRoot(cwd);
  if (mainRoot) {
    let realTarget = targetPath;
    try {
      realTarget = fs.realpathSync(targetPath);
    } catch {
      realTarget = path.resolve(targetPath);
    }
    if (realTarget === mainRoot) {
      throw new WorktreeError("can't remove the main worktree");
    }
  }
  const result = await runGit(cwd, ["worktree", "remove", targetPath]);
  if (result.exitCode !== 0) {
    throw new WorktreeError(result.stderr.trim() || "git worktree remove failed");
  }
};
