import fs from "node:fs";
import path from "node:path";
import {
  WORKTREE_SWEEP_BATCH_LIMIT,
  WORKTREE_SWEEP_MAX_AGE_DAYS,
  REPO_MARKER_FILENAME,
} from "../constants.js";
import { WORKTREES_PARENT_DIR, listGitWorktrees } from "../git-worktrees.js";
import { runGit } from "./run-git.js";

const MS_PER_DAY_MS = 24 * 60 * 60 * 1000;

// A worktree is sweepable iff it is auto-created (lives under the shared
// ~/.localterm/worktrees dir, so a worktree the user made manually elsewhere is
// never touched), is older than the cutoff, and is clean — no uncommitted
// changes and no untracked files. `git worktree remove` (without --force)
// double-gates cleanliness: git itself refuses a dirty worktree, so a clean
// check that raced with a concurrent edit still can't lose work. The branch
// ref is left behind by `worktree remove`, so even a swept worktree with
// unpushed commits is recoverable via `git worktree add <path> <branch>`.
const isAutoCreated = (worktreePath: string): boolean => {
  const parentWithSeparator = `${WORKTREES_PARENT_DIR}${path.sep}`;
  return worktreePath === WORKTREES_PARENT_DIR || worktreePath.startsWith(parentWithSeparator);
};

const isClean = async (worktreePath: string): Promise<boolean> => {
  const result = await runGit(worktreePath, ["status", "--porcelain", "-uall"]);
  if (result.exitCode !== 0) return false;
  return result.stdout.toString("utf8").trim().length === 0;
};

const worktreeAgeMs = (worktreePath: string, now: number): number | null => {
  try {
    const stat = fs.statSync(worktreePath);
    return now - stat.mtimeMs;
  } catch {
    return null;
  }
};

// After a worktree is removed its project folder may be left holding only the
// repo-id marker — the sweep just took the last worktree, so the folder is dead
// weight. Reap it, but only when nothing else remains: a kept sibling worktree
// or any file the user dropped in must never be deleted. The folder is always
// this repo's own project folder (the parent of an auto-created worktree), so
// there's no cross-repo risk.
const reapEmptyProjectFolder = (worktreePath: string): void => {
  const projectFolder = path.dirname(worktreePath);
  if (projectFolder === WORKTREES_PARENT_DIR) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(projectFolder);
  } catch {
    return;
  }
  if (!entries.every((entry) => entry === REPO_MARKER_FILENAME)) return;
  fs.rmSync(projectFolder, { recursive: true, force: true });
};

// Removes stale, clean, auto-created worktrees so the shared worktrees dir
// doesn't accumulate orphans. Returns the paths actually removed. The current
// and main worktrees are never eligible; a dirty, too-new, or shell-occupied
// worktree is skipped silently. Never throws — a worktree that fails to remove
// is simply not in the returned list, so a sweep never breaks the list view
// that triggered it. A project folder emptied by the sweep is reaped too.
export const sweepStaleWorktrees = async (
  cwd: string,
  now: number = Date.now(),
  isWorktreeBusy: (worktreePath: string) => boolean = () => false,
): Promise<{ removed: string[] }> => {
  const cutoff = WORKTREE_SWEEP_MAX_AGE_DAYS * MS_PER_DAY_MS;

  let worktrees;
  try {
    const list = await listGitWorktrees(cwd);
    worktrees = list.worktrees;
  } catch {
    return { removed: [] };
  }

  const removed: string[] = [];
  for (const worktree of worktrees) {
    if (removed.length >= WORKTREE_SWEEP_BATCH_LIMIT) break;
    if (worktree.isMain || worktree.isCurrent) continue;
    if (!isAutoCreated(worktree.path)) continue;

    const age = worktreeAgeMs(worktree.path, now);
    if (age === null || age < cutoff) continue;

    // A shell still sitting in a stale worktree blocks the sweep too — same
    // reason as the delete route. Checked before the git cleanliness spawn
    // since it's an in-memory lookup.
    if (isWorktreeBusy(worktree.path)) continue;

    if (!(await isClean(worktree.path))) continue;

    const result = await runGit(cwd, ["worktree", "remove", worktree.path]);
    if (result.exitCode === 0) {
      removed.push(worktree.path);
      reapEmptyProjectFolder(worktree.path);
    }
  }
  return { removed };
};
