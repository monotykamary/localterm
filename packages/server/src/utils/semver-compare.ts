// Compares two semver-ish version strings by their leading numeric
// major.minor.patch. Returns positive if `a` is newer, negative if `b` is
// newer, and 0 if they are equal OR either string can't be parsed — a garbage
// registry response (or an unparseable `currentVersion`) must never flag a
// spurious update, so an unparseable operand collapses to "not newer".
const parseSemver = (version: string): readonly [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return [major, minor, patch] as const;
};

export const compareSemver = (a: string, b: string): number => {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (parsedA === null || parsedB === null) return 0;
  for (let index = 0; index < 3; index += 1) {
    const diff = parsedA[index] - parsedB[index];
    if (diff !== 0) return diff;
  }
  return 0;
};
