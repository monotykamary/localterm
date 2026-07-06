export interface QueryMatch {
  score: number;
  indices: readonly number[];
}

// Subsequence fuzzy match: every character of `query` must appear in `target`
// in order, with bonuses for adjacent hits and word boundaries (space or
// hyphen). Inputs must already be lowercased by the caller so the returned
// indices line up with the caller's lowercased text.
export const fuzzyMatch = (query: string, target: string): QueryMatch | null => {
  let queryIndex = 0;
  let score = 0;
  let previousMatchIndex = -1;
  const indices: number[] = [];
  for (
    let targetIndex = 0;
    targetIndex < target.length && queryIndex < query.length;
    targetIndex += 1
  ) {
    if (target[targetIndex] === query[queryIndex]) {
      score += 1;
      if (previousMatchIndex === targetIndex - 1) score += 0.5;
      if (targetIndex === 0 || target[targetIndex - 1] === " " || target[targetIndex - 1] === "-")
        score += 0.5;
      previousMatchIndex = targetIndex;
      indices.push(targetIndex);
      queryIndex += 1;
    }
  }
  return queryIndex === query.length ? { score, indices } : null;
};

// The maximum score fuzzyMatch can award for a query of this length (every
// character matched, all adjacent, all on word boundaries). Callers divide a
// fuzzy score by this to normalize onto a 0..1 range, keeping subsequence
// matches ranked below exact, prefix, and substring hits.
export const fuzzyMaxScore = (queryLength: number): number => {
  let score = queryLength;
  score += (queryLength - 1) * 0.5;
  score += queryLength * 0.5;
  return score;
};
