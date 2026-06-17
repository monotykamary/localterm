export interface FileAddDel {
  additions: number;
  deletions: number;
  binary: boolean;
}

// Reconcile per-file +/- counts toward the authoritative aggregate from
// git's diff.stats(). jsdiff's per-file patch counts (computePatchFromContents)
// drift from git's totals on trailing-newline / line-ending edge cases, and the
// drift accumulates across a large diff — so nudge each file ±1 toward the
// aggregate until they match. Per-file counts must never go negative (the wire
// schema rejects them), so a surplus (per-file sum exceeds the aggregate) is
// only taken from files that have room; any leftover remainder is left
// unreconciled rather than producing a negative count.
export const reconcileFileStats = <T extends FileAddDel>(
  files: T[],
  totalInsertions: number,
  totalDeletions: number,
): void => {
  let computedAdds = 0;
  let computedDels = 0;
  for (const file of files) {
    if (file.binary) continue;
    computedAdds += file.additions;
    computedDels += file.deletions;
  }

  let remainingAdd = totalInsertions - computedAdds;
  let remainingDel = totalDeletions - computedDels;
  if (remainingAdd === 0 && remainingDel === 0) return;

  for (const file of files) {
    if (file.binary) continue;
    if (remainingAdd > 0) {
      file.additions += 1;
      remainingAdd -= 1;
    } else if (remainingAdd < 0 && file.additions > 0) {
      file.additions -= 1;
      remainingAdd += 1;
    }
    if (remainingDel > 0) {
      file.deletions += 1;
      remainingDel -= 1;
    } else if (remainingDel < 0 && file.deletions > 0) {
      file.deletions -= 1;
      remainingDel += 1;
    }
    if (remainingAdd === 0 && remainingDel === 0) break;
  }
};
