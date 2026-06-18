import fs from "node:fs";
import path from "node:path";
import {
  MAX_WORKTREEINCLUDE_FILES,
  MAX_WORKTREEINCLUDE_TOTAL_BYTES,
  WORKTREEINCLUDE_FILENAME,
} from "../constants.js";
import { runGit } from "./run-git.js";

// `.worktreeinclude` (gitignore-syntax, repo-root) names gitignored files to
// copy from the main worktree into each fresh worktree so a new checkout is
// immediately usable — `.env`, `config/secrets.json`, etc. Only files git
// ignores are ever copied (tracked files are the repo's job); a `.worktreeinclude`
// alone never duplicates tracked content.
//
// The patterns double as git pathspecs: `git ls-files --others --ignored
// --exclude-standard -- <patterns>` lists untracked, gitignored files matching
// any pattern, which is exactly the intersection we want ("matches a pattern
// AND is gitignored"). Pathspec matching keeps huge ignored trees (node_modules)
// out of the enumeration unless a pattern names them.

const parseIncludePatterns = (filePath: string): string[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const patterns: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Negations re-include, which is meaningless for a copy allowlist; skip
    // them rather than risk copying the wrong set.
    if (trimmed.startsWith("!")) continue;
    patterns.push(trimmed.replace(/^\/+/, ""));
  }
  return patterns;
};

// Reject relative paths that escape the worktree root. The include file lives in
// the user's own repo, so this is defense-in-depth, not a trust boundary.
const isSafeRelativePath = (rel: string): boolean => {
  if (path.isAbsolute(rel)) return false;
  return rel.split("/").every((segment) => segment !== ".." && segment !== "");
};

const listMatchedIgnoredFiles = async (mainRoot: string, patterns: string[]): Promise<string[]> => {
  const result = await runGit(mainRoot, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
    "--",
    ...patterns,
  ]);
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter((rel) => rel.length > 0 && isSafeRelativePath(rel));
};

// Returns the relative paths actually copied. Empty when the repo has no
// `.worktreeinclude`, nothing matches, or any step hits a bound — copy failures
// never throw, since they can't be allowed to fail the worktree creation that
// invited the copy (git already succeeded; the missing .env is a usability
// nuisance, not a corrupt worktree).
export const copyWorktreeIncludes = async (
  mainRoot: string,
  destPath: string,
): Promise<string[]> => {
  const patterns = parseIncludePatterns(path.join(mainRoot, WORKTREEINCLUDE_FILENAME));
  if (patterns.length === 0) return [];

  const matched = await listMatchedIgnoredFiles(mainRoot, patterns);
  if (matched.length === 0) return [];

  const copied: string[] = [];
  let totalBytes = 0;
  for (const rel of matched.slice(0, MAX_WORKTREEINCLUDE_FILES)) {
    const src = path.join(mainRoot, rel);
    const dest = path.join(destPath, rel);
    let size: number;
    try {
      const stat = fs.statSync(src);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }
    if (totalBytes + size > MAX_WORKTREEINCLUDE_TOTAL_BYTES) break;
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied.push(rel);
      totalBytes += size;
    } catch {
      continue;
    }
  }
  return copied;
};
