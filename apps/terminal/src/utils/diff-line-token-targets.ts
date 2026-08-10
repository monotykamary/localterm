import type { DiffHunk } from "@/utils/parse-unified-diff";

// Where a rendered diff row pulls its syntax tokens from: a side of the real
// documents (old = comparison base blob, new = working-tree file), docLine
// being the 0-based line index within that side.
export interface DiffLineTokenTarget {
  side: "old" | "new";
  docLine: number;
}

export interface DocumentTokenTargets {
  targets: DiffLineTokenTarget[];
  // Deepest line each side must highlight. Tokenization stops there:
  // anything past the last shown hunk line is never displayed.
  oldMaxLines: number;
  newMaxLines: number;
}

// Hunk line numbers index the real per-side documents, so highlighting comes
// from full-file grammar state instead of an isolated fragment.
export const buildDocumentTokenTargets = (hunks: readonly DiffHunk[]): DocumentTokenTargets => {
  const targets: DiffLineTokenTarget[] = [];
  let oldMaxLines = 0;
  let newMaxLines = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "del") {
        targets.push({ side: "old", docLine: (line.oldLine ?? 1) - 1 });
        oldMaxLines = Math.max(oldMaxLines, line.oldLine ?? 1);
        continue;
      }
      targets.push({ side: "new", docLine: (line.newLine ?? 1) - 1 });
      newMaxLines = Math.max(newMaxLines, line.newLine ?? 1);
      if (line.type === "context") oldMaxLines = Math.max(oldMaxLines, line.oldLine ?? 1);
    }
  }
  return { targets, oldMaxLines, newMaxLines };
};

export interface FragmentTokenTargets {
  targets: DiffLineTokenTarget[];
  oldText: string;
  newText: string;
  oldMaxLines: number;
  newMaxLines: number;
}

// Fallback for when the real documents are unfetchable (offline, older
// server): each side's hunk lines form one synthetic stream, so state on the
// removal side can never bleed into added lines and vice versa. Cross-hunk
// bleed within a side is still possible, but never crosses sides.
export const buildFragmentTokenTargets = (hunks: readonly DiffHunk[]): FragmentTokenTargets => {
  const targets: DiffLineTokenTarget[] = [];
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type !== "add") {
        oldLines.push(line.text);
      }
      if (line.type !== "del") {
        newLines.push(line.text);
      }
      targets.push(
        line.type === "del"
          ? { side: "old", docLine: oldLines.length - 1 }
          : { side: "new", docLine: newLines.length - 1 },
      );
    }
  }
  return {
    targets,
    oldText: oldLines.join("\n"),
    newText: newLines.join("\n"),
    oldMaxLines: oldLines.length,
    newMaxLines: newLines.length,
  };
};
