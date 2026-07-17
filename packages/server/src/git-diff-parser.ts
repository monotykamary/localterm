import type { GitDiffFileStatus } from "./types.js";

export interface NumstatEntry {
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}

export const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1;
  }
  if (!text.endsWith("\n")) count += 1;
  return count;
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
export const indexPatchesByPath = (raw: string): Map<string, string> => {
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
