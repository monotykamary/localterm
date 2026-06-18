import fs from "node:fs";
import path from "node:path";
import { MAX_WORKTREEINCLUDE_FILE_BYTES, WORKTREEINCLUDE_FILENAME } from "../constants.js";
import { mainWorktreeRoot } from "../git-worktrees.js";
import type { WorktreeIncludeFile } from "../types.js";

const includeFilePath = (mainRoot: string): string => path.join(mainRoot, WORKTREEINCLUDE_FILENAME);

// Read the repo's `.worktreeinclude` file. Returns `exists: false` when the file
// is absent; the caller can still offer the constant filename and an empty
// editor so the user knows where to add one.
export const readWorktreeIncludeFile = async (cwd: string): Promise<WorktreeIncludeFile | null> => {
  const mainRoot = await mainWorktreeRoot(cwd);
  if (!mainRoot) return null;
  const filePath = includeFilePath(mainRoot);
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (!isMissingError(error)) return null;
    return { exists: false, content: "", path: WORKTREEINCLUDE_FILENAME };
  }
  return {
    exists: true,
    content: content.slice(0, MAX_WORKTREEINCLUDE_FILE_BYTES),
    path: WORKTREEINCLUDE_FILENAME,
  };
};

// Write (or delete) the repo's `.worktreeinclude` file. Empty content removes
// the file so the repo reverts to the pre-config state. Content is capped so a
// huge paste can't bloat repo root.
export const writeWorktreeIncludeFile = async (
  cwd: string,
  content: string,
): Promise<WorktreeIncludeFile | null> => {
  const mainRoot = await mainWorktreeRoot(cwd);
  if (!mainRoot) return null;
  const filePath = includeFilePath(mainRoot);
  const trimmed = content.slice(0, MAX_WORKTREEINCLUDE_FILE_BYTES).trim();
  if (trimmed === "") {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      if (!isMissingError(error)) return null;
    }
    return { exists: false, content: "", path: WORKTREEINCLUDE_FILENAME };
  }
  try {
    fs.writeFileSync(filePath, `${trimmed}\n`, "utf8");
  } catch {
    return null;
  }
  return { exists: true, content: trimmed, path: WORKTREEINCLUDE_FILENAME };
};

const isMissingError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "ENOENT" || error.code === "ENOTDIR");
