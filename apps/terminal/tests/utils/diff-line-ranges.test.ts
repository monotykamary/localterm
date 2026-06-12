import { describe, expect, it } from "vite-plus/test";
import {
  buildDiffLineRangeIndex,
  coveredTargetKeys,
  diffLineTargetFor,
  diffLineTargetKey,
  resolveDragRange,
  type DiffLineTarget,
} from "../../src/utils/diff-line-ranges";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

// Two hunks; the first mixes context, deletions, and additions so document
// order interleaves old- and new-side targets:
//   ctx "a"   → new:1, del "b" → old:2, del "c" → old:3,
//   add "B"   → new:2, add "C" → new:3, add "D" → new:4, ctx "d" → new:5
// and the second hunk starts at ctx "j" → new:11.
const PATCH = [
  "@@ -1,4 +1,5 @@",
  " a",
  "-b",
  "-c",
  "+B",
  "+C",
  "+D",
  " d",
  "@@ -10,2 +11,3 @@",
  " j",
  "+K",
  " k",
  "",
].join("\n");

const hunks = parseUnifiedDiff(PATCH);
const index = buildDiffLineRangeIndex(hunks);

const target = (side: "old" | "new", lineNumber: number): DiffLineTarget => ({
  side,
  lineNumber,
});

describe("diffLineTargetFor", () => {
  it("addresses deleted lines on the old side and everything else on the new side", () => {
    const [ctx, del] = hunks[0].lines;
    expect(diffLineTargetFor(ctx)).toEqual(target("new", 1));
    expect(diffLineTargetFor(del)).toEqual(target("old", 2));
  });
});

describe("resolveDragRange", () => {
  it("keeps a forward drag in document order", () => {
    const range = resolveDragRange(index, target("new", 1), target("new", 3));
    expect(range).toEqual({ start: target("new", 1), end: target("new", 3) });
  });

  it("normalizes an upward drag so the anchor becomes the end", () => {
    const range = resolveDragRange(index, target("new", 3), target("new", 1));
    expect(range).toEqual({ start: target("new", 1), end: target("new", 3) });
  });

  it("clamps a downward drag to the anchor's hunk", () => {
    // Anchor on the last line of hunk 0, focus inside hunk 1.
    const range = resolveDragRange(index, target("new", 5), target("new", 11));
    expect(range).toEqual({ start: target("new", 5), end: target("new", 5) });
  });

  it("clamps an upward drag to the anchor's hunk", () => {
    const range = resolveDragRange(index, target("new", 12), target("new", 5));
    expect(range).toEqual({ start: target("new", 11), end: target("new", 12) });
  });

  it("returns null when either end is not an annotatable line", () => {
    expect(resolveDragRange(index, target("new", 1), target("old", 999))).toBeNull();
    expect(resolveDragRange(index, target("old", 999), target("new", 1))).toBeNull();
  });
});

describe("coveredTargetKeys", () => {
  it("covers every line between the ends inclusive, across sides", () => {
    const keys = coveredTargetKeys(index, {
      start: target("new", 1),
      end: target("new", 3),
    });
    // ctx a, del b, del c, add B, add C — deletions sit between in document order.
    expect([...keys].sort()).toEqual(
      [
        diffLineTargetKey(target("new", 1)),
        diffLineTargetKey(target("old", 2)),
        diffLineTargetKey(target("old", 3)),
        diffLineTargetKey(target("new", 2)),
        diffLineTargetKey(target("new", 3)),
      ].sort(),
    );
  });

  it("is empty when an end is missing from the diff", () => {
    const keys = coveredTargetKeys(index, {
      start: target("new", 1),
      end: target("new", 999),
    });
    expect(keys.size).toBe(0);
  });
});
