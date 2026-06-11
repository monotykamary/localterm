/**
 * Compact count for the diff indicator pill: 999 stays "999", 1 234 becomes
 * "1.2k", 12 345 becomes "12k" — keeps the overlay narrow on huge diffs.
 */
export const formatDiffCount = (count: number): string => {
  if (count < 1000) return String(count);
  if (count < 10_000) {
    const compact = (count / 1000).toFixed(1).replace(/\.0$/, "");
    return `${compact}k`;
  }
  return `${Math.round(count / 1000)}k`;
};
