import { describe, expect, it } from "vite-plus/test";
import { buildDisplayHunks } from "../../src/utils/build-display-hunks";
import type { DiffLine, DiffHunk } from "../../src/utils/parse-unified-diff";

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

const del = (text: string, oldLine: number): DiffLine => ({
  type: "del",
  text,
  oldLine,
  newLine: null,
  noNewline: false,
});

const hunk = (lines: DiffLine[], header = "@@ -1,1 +1,1 @@"): DiffHunk => ({ header, lines });

const exit = (line: DiffLine) => ({ key: `key:${line.type}:${line.text}`, line, addedAt: 0 });

const flatTokens = (hunks: DiffHunk[]) =>
  hunks.flatMap((hunk) =>
    hunk.lines.map((line) =>
      line.type === "context"
        ? `=${line.text}`
        : line.type === "add"
          ? `+${line.text}`
          : `-${line.text}`,
    ),
  );

describe("buildDisplayHunks", () => {
  it("returns a copy of the input when there are no exiting lines", () => {
    const hunks = [hunk([context("a", 1, 1), context("b", 2, 2)])];
    const result = buildDisplayHunks(hunks, []);
    expect(result).not.toBe(hunks);
    expect(result).toEqual(hunks);
  });

  it("places a deleted line before the context line that follows it", () => {
    const hunks = [hunk([context("b", 2, 1)])];
    const exiting = [exit(del("a", 1))];
    const result = buildDisplayHunks(hunks, exiting);
    expect(flatTokens(result)).toEqual(["-a", "=b"]);
  });

  it("places removed added lines around the surviving added line when trimming a block", () => {
    const previousBlock = [add("one", 1), add("two", 2), add("three", 3)];
    const hunks = [hunk([context("base", 1, 1), add("two", 2), context("after", 2, 3)])];
    const exiting = previousBlock.filter((line) => line.text !== "two").map(exit);
    const result = buildDisplayHunks(hunks, exiting);
    const tokens = flatTokens(result);
    expect(tokens).toEqual(["+one", "=base", "+two", "+three", "=after"]);
  });

  it("orders interleaved exits before replacements at the same position", () => {
    const hunks = [hunk([context("base", 1, 1), add("x", 2), add("y", 3), context("after", 4, 4)])];
    const exiting = [exit(del("b", 3)), exit(del("a", 2))];
    const result = buildDisplayHunks(hunks, exiting);
    expect(flatTokens(result)).toEqual(["=base", "-a", "+x", "-b", "+y", "=after"]);
  });

  it("appends exits that fall after every current line to the last hunk", () => {
    const hunks = [hunk([context("a", 1, 1)])];
    const exiting = [exit(del("z", 5))];
    const result = buildDisplayHunks(hunks, exiting);
    expect(flatTokens(result)).toEqual(["=a", "-z"]);
  });

  it("distributes exits across multiple hunks", () => {
    const hunks = [
      hunk([context("b", 2, 2)], "@@ -2,1 +2,1 @@"),
      hunk([context("d", 5, 5)], "@@ -5,1 +5,1 @@"),
    ];
    const exiting = [exit(del("a", 1)), exit(del("c", 4))];
    const result = buildDisplayHunks(hunks, exiting);
    expect(flatTokens(result)).toEqual(["-a", "=b", "-c", "=d"]);
  });
});
