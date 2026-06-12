import type { DiffHunk, DiffLine } from "@/utils/parse-unified-diff";

// File-local address of a diff line: which side owns it plus its line number
// on that side. diffAnnotationKey layers the file path on top of this.
export interface DiffLineTarget {
  side: "old" | "new";
  lineNumber: number;
}

// Deleted lines are addressed on the old side, everything else on the new side.
export const diffLineTargetFor = (line: DiffLine): DiffLineTarget | null => {
  if (line.type === "del") {
    return line.oldLine === null ? null : { side: "old", lineNumber: line.oldLine };
  }
  return line.newLine === null ? null : { side: "new", lineNumber: line.newLine };
};

export const diffLineTargetKey = (target: DiffLineTarget): string =>
  `${target.side}:${target.lineNumber}`;

// An inclusive run of diff lines in document order. The annotation anchors at
// `end`, mirroring GitHub where a multiline comment hangs off its last line.
export interface DiffLineRange {
  start: DiffLineTarget;
  end: DiffLineTarget;
}

interface IndexedTarget {
  target: DiffLineTarget;
  hunkIndex: number;
  order: number;
}

export interface DiffLineRangeIndex {
  ordered: readonly IndexedTarget[];
  byKey: ReadonlyMap<string, IndexedTarget>;
}

/**
 * Index every annotatable line of a file's hunks by document order, so drag
 * selections spanning old- and new-side lines can be normalized and compared.
 */
export const buildDiffLineRangeIndex = (hunks: readonly DiffHunk[]): DiffLineRangeIndex => {
  const ordered: IndexedTarget[] = [];
  const byKey = new Map<string, IndexedTarget>();
  hunks.forEach((hunk, hunkIndex) => {
    for (const line of hunk.lines) {
      const target = diffLineTargetFor(line);
      if (!target) continue;
      const entry: IndexedTarget = { target, hunkIndex, order: ordered.length };
      ordered.push(entry);
      byKey.set(diffLineTargetKey(target), entry);
    }
  });
  return { ordered, byKey };
};

const lastInHunk = (index: DiffLineRangeIndex, entry: IndexedTarget): IndexedTarget => {
  let result = entry;
  for (let i = entry.order + 1; i < index.ordered.length; i += 1) {
    if (index.ordered[i].hunkIndex !== entry.hunkIndex) break;
    result = index.ordered[i];
  }
  return result;
};

const firstInHunk = (index: DiffLineRangeIndex, entry: IndexedTarget): IndexedTarget => {
  let result = entry;
  for (let i = entry.order - 1; i >= 0; i -= 1) {
    if (index.ordered[i].hunkIndex !== entry.hunkIndex) break;
    result = index.ordered[i];
  }
  return result;
};

/**
 * Resolve a drag gesture into an inclusive document-order range. Dragging
 * upward swaps the ends, and the side away from the anchor is clamped to the
 * anchor's hunk — a range cannot span hunks. Returns null when either end is
 * not an annotatable line of this diff.
 */
export const resolveDragRange = (
  index: DiffLineRangeIndex,
  anchor: DiffLineTarget,
  focus: DiffLineTarget,
): DiffLineRange | null => {
  const anchorEntry = index.byKey.get(diffLineTargetKey(anchor));
  const focusEntry = index.byKey.get(diffLineTargetKey(focus));
  if (!anchorEntry || !focusEntry) return null;
  let startEntry = anchorEntry.order <= focusEntry.order ? anchorEntry : focusEntry;
  let endEntry = anchorEntry.order <= focusEntry.order ? focusEntry : anchorEntry;
  if (startEntry.hunkIndex !== endEntry.hunkIndex) {
    if (startEntry === anchorEntry) {
      endEntry = lastInHunk(index, anchorEntry);
    } else {
      startEntry = firstInHunk(index, anchorEntry);
    }
  }
  return { start: startEntry.target, end: endEntry.target };
};

/** Keys (diffLineTargetKey) of every line the range covers, inclusive. */
export const coveredTargetKeys = (
  index: DiffLineRangeIndex,
  range: DiffLineRange,
): Set<string> => {
  const keys = new Set<string>();
  const startEntry = index.byKey.get(diffLineTargetKey(range.start));
  const endEntry = index.byKey.get(diffLineTargetKey(range.end));
  if (!startEntry || !endEntry || startEntry.order > endEntry.order) return keys;
  for (let i = startEntry.order; i <= endEntry.order; i += 1) {
    keys.add(diffLineTargetKey(index.ordered[i].target));
  }
  return keys;
};
