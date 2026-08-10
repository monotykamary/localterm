import type { DiffLineTokenTarget } from "./diff-line-token-targets";
import type { DiffLine } from "./parse-unified-diff";
import type { MaterializedDocumentTokens } from "./syntax-token-manager";
import type { SyntaxLine } from "./syntax-highlight";

// Map rendered diff rows to their syntax-highlighted lines. Targets that land
// outside the tokenized range (beyond the tokenization bound, or on a missing
// side) stay plain; rows whose doc text no longer matches the diff text (the
// contents were read during a racing edit) also stay plain rather than
// painting stale scopes.
export const buildDiffTokenMap = (
  allLines: readonly DiffLine[],
  targets: readonly DiffLineTokenTarget[],
  materialized: MaterializedDocumentTokens,
): Map<DiffLine, SyntaxLine> => {
  const map = new Map<DiffLine, SyntaxLine>();
  for (let index = 0; index < allLines.length; index += 1) {
    const diffLine = allLines[index];
    const target = targets[index];
    if (!diffLine || !target) continue;
    const sideLines = target.side === "old" ? materialized.old : materialized.next;
    if (!sideLines) continue;
    const line = sideLines[target.docLine];
    if (!line) continue;
    let joined = "";
    for (const innerToken of line.tokens) joined += innerToken.content;
    if (joined !== diffLine.text) continue;
    map.set(diffLine, line);
  }
  return map;
};
