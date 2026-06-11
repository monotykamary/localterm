import type { DiffHunk, DiffLine } from "@/utils/parse-unified-diff";

export interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pair a hunk's lines into side-by-side rows: context lines occupy both
 * sides, and each run of deletions pairs index-by-index with the run of
 * additions that follows it (the standard split-diff alignment).
 */
export const buildSplitDiffRows = (hunk: DiffHunk): SplitDiffRow[] => {
  const rows: SplitDiffRow[] = [];
  let pendingDeletions: DiffLine[] = [];
  let pendingAdditions: DiffLine[] = [];

  const flushPending = () => {
    const pairCount = Math.max(pendingDeletions.length, pendingAdditions.length);
    for (let index = 0; index < pairCount; index += 1) {
      rows.push({
        left: pendingDeletions[index] ?? null,
        right: pendingAdditions[index] ?? null,
      });
    }
    pendingDeletions = [];
    pendingAdditions = [];
  };

  for (const line of hunk.lines) {
    if (line.type === "del") {
      pendingDeletions.push(line);
      continue;
    }
    if (line.type === "add") {
      pendingAdditions.push(line);
      continue;
    }
    flushPending();
    rows.push({ left: line, right: line });
  }
  flushPending();

  return rows;
};
