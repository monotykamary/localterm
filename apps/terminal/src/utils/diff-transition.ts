import type { DiffLine } from "@/utils/parse-unified-diff";
import { addedLineKey, lineKey } from "@/utils/diff-line-identifiers";

export interface ExitingLine {
  key: string;
  line: DiffLine;
  addedAt: number;
}

export interface ComputeDiffTransitionInput {
  previousLines: readonly DiffLine[];
  currentLines: readonly DiffLine[];
  previousAddKeys: ReadonlySet<string>;
  getTimestamp?: () => number;
}

export interface ComputeDiffTransitionResult {
  currentAddKeys: ReadonlySet<string>;
  currentKeys: ReadonlySet<string>;
  freshAddKeys: ReadonlySet<string>;
  hadPreviousPatch: boolean;
  newExitingLines: readonly ExitingLine[];
}

export const computeDiffTransition = ({
  previousLines,
  currentLines,
  previousAddKeys,
  getTimestamp = Date.now,
}: ComputeDiffTransitionInput): ComputeDiffTransitionResult => {
  const currentKeys = new Set(currentLines.map(lineKey));

  const currentAddKeys = new Set<string>();
  const freshAddKeys = new Set<string>();
  for (const line of currentLines) {
    if (line.type !== "add") continue;
    const key = addedLineKey(line);
    currentAddKeys.add(key);
    if (!previousAddKeys.has(key)) freshAddKeys.add(key);
  }

  const hadPreviousPatch = previousLines.length > 0;
  const newExitingLines: ExitingLine[] = [];
  if (hadPreviousPatch) {
    for (const line of previousLines) {
      const key = lineKey(line);
      if (!currentKeys.has(key)) {
        newExitingLines.push({ key, line, addedAt: getTimestamp() });
      }
    }
  }

  return {
    currentAddKeys,
    currentKeys,
    freshAddKeys,
    hadPreviousPatch,
    newExitingLines,
  };
};
