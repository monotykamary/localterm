import { describe, expect, it } from "vite-plus/test";
import { computeDiffTransition } from "../../src/utils/diff-transition";
import { addedLineKey } from "../../src/utils/diff-line-identifiers";
import type { DiffLine } from "../../src/utils/parse-unified-diff";

const context = (text: string, oldLine: number, newLine: number): DiffLine => ({
  type: "context",
  text,
  oldLine,
  newLine,
  noNewline: false,
});

const add = (text: string, newLine: number): DiffLine => ({
  type: "add",
  text,
  oldLine: null,
  newLine,
  noNewline: false,
});

describe("computeDiffTransition", () => {
  it("flags a newly added line on the first patch", () => {
    const line = add("x", 1);
    const result = computeDiffTransition({
      previousLines: [],
      currentLines: [line],
      previousAddKeys: new Set(),
    });

    expect(result.hadPreviousPatch).toBe(false);
    expect(result.freshAddKeys.has(addedLineKey(line))).toBe(true);
    expect(result.newExitingLines).toHaveLength(0);
  });

  it("does not re-flag an added line that is still present", () => {
    const line = add("x", 1);
    const result = computeDiffTransition({
      previousLines: [line],
      currentLines: [line],
      previousAddKeys: new Set([addedLineKey(line)]),
    });

    expect(result.freshAddKeys.size).toBe(0);
    expect(result.newExitingLines).toHaveLength(0);
  });

  it("flags a previously added line as exiting when it is removed", () => {
    const previous = [context("base", 1, 1), add("x", 2)];
    const current = [context("base", 1, 1)];
    const result = computeDiffTransition({
      previousLines: previous,
      currentLines: current,
      previousAddKeys: new Set([addedLineKey(previous[1])]),
    });

    expect(result.newExitingLines).toHaveLength(1);
    expect(result.newExitingLines[0].line.text).toBe("x");
  });

  it("flags a context line as exiting when it is deleted", () => {
    const previous = [context("a", 1, 1), context("b", 2, 2)];
    const current = [context("a", 1, 1)];
    const result = computeDiffTransition({
      previousLines: previous,
      currentLines: current,
      previousAddKeys: new Set(),
    });

    expect(result.newExitingLines).toHaveLength(1);
    expect(result.newExitingLines[0].line.text).toBe("b");
  });

  it("flags an added line that was removed and then added back", () => {
    const added = add("x", 1);
    const afterRemoval = computeDiffTransition({
      previousLines: [added],
      currentLines: [context("y", 1, 1)],
      previousAddKeys: new Set([addedLineKey(added)]),
    });

    expect(afterRemoval.newExitingLines).toHaveLength(1);

    const readded = add("x", 1);
    const afterReadd = computeDiffTransition({
      previousLines: [context("y", 1, 1)],
      currentLines: [context("y", 1, 1), readded],
      previousAddKeys: afterRemoval.currentAddKeys,
    });

    expect(afterReadd.freshAddKeys.has(addedLineKey(readded))).toBe(true);
    expect(afterReadd.newExitingLines).toHaveLength(0);
  });
});
