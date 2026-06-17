import type { DiffHunk, DiffLine } from "@/utils/parse-unified-diff";
import type { ExitingLine } from "@/utils/diff-transition";

export const buildDisplayHunks = (
  hunks: readonly DiffHunk[],
  exitingLines: readonly ExitingLine[],
): DiffHunk[] => {
  if (exitingLines.length === 0) return [...hunks];

  const linePosition = (line: DiffLine) => line.newLine ?? line.oldLine ?? Infinity;

  const sorted = exitingLines.slice().sort((a, b) => {
    const aPosition = linePosition(a.line);
    const bPosition = linePosition(b.line);
    if (aPosition !== bPosition) return aPosition - bPosition;
    const aOld = a.line.oldLine ?? -1;
    const bOld = b.line.oldLine ?? -1;
    if (aOld !== bOld) return aOld - bOld;
    return (a.line.newLine ?? -1) - (b.line.newLine ?? -1);
  });

  const result: DiffHunk[] = [];
  let exitIndex = 0;
  for (const hunk of hunks) {
    const lines: DiffLine[] = [];
    for (const line of hunk.lines) {
      while (
        exitIndex < sorted.length &&
        linePosition(sorted[exitIndex].line) <= linePosition(line)
      ) {
        lines.push(sorted[exitIndex].line);
        exitIndex += 1;
      }
      lines.push(line);
    }
    result.push({ ...hunk, lines });
  }

  if (exitIndex < sorted.length) {
    const lastHunk = result[result.length - 1];
    const tailLines = sorted.slice(exitIndex).map((entry) => entry.line);
    if (lastHunk) {
      lastHunk.lines.push(...tailLines);
    } else {
      result.push({ header: "", lines: tailLines });
    }
  }

  return result;
};
