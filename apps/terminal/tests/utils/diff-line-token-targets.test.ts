import { describe, expect, it } from "vite-plus/test";
import {
  buildDocumentTokenTargets,
  buildFragmentTokenTargets,
} from "../../src/utils/diff-line-token-targets";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

describe("buildDocumentTokenTargets", () => {
  it("maps deleted lines to the old side and context/added to the new side", () => {
    const hunks = parseUnifiedDiff(
      ["@@ -10,3 +10,3 @@", " alpha", "-beta", "+BETA", " gamma"].join("\n"),
    );
    const result = buildDocumentTokenTargets(hunks);
    expect(result.targets).toEqual([
      { side: "new", docLine: 9 },
      { side: "old", docLine: 10 },
      { side: "new", docLine: 10 },
      { side: "new", docLine: 11 },
    ]);
    expect(result.oldMaxLines).toBe(12);
    expect(result.newMaxLines).toBe(12);
  });

  it("bounds tokenization at the deepest shown line across multiple hunks", () => {
    const hunks = parseUnifiedDiff(
      ["@@ -1 +1 @@", "-one", "+ONE", "@@ -40 +42 @@", " context"].join("\n"),
    );
    const result = buildDocumentTokenTargets(hunks);
    expect(result.targets).toEqual([
      { side: "old", docLine: 0 },
      { side: "new", docLine: 0 },
      { side: "new", docLine: 41 },
    ]);
    expect(result.oldMaxLines).toBe(40);
    expect(result.newMaxLines).toBe(42);
  });

  it("handles untracked (all-add) patches where the old side is empty", () => {
    const hunks = parseUnifiedDiff("@@ -0,0 +1,2 @@\n+one\n+two");
    const result = buildDocumentTokenTargets(hunks);
    expect(result.targets).toEqual([
      { side: "new", docLine: 0 },
      { side: "new", docLine: 1 },
    ]);
    expect(result.oldMaxLines).toBe(0);
    expect(result.newMaxLines).toBe(2);
  });
});

describe("buildFragmentTokenTargets", () => {
  it("keeps removed and added text in separate streams", () => {
    const hunks = parseUnifiedDiff(
      ["@@ -1,3 +1,3 @@", " alpha", "-const s = `unterminated", "+const next = 2", " gamma"].join(
        "\n",
      ),
    );
    const result = buildFragmentTokenTargets(hunks);
    expect(result.oldText).toBe("alpha\nconst s = `unterminated\ngamma");
    expect(result.newText).toBe("alpha\nconst next = 2\ngamma");
    expect(result.targets).toEqual([
      { side: "new", docLine: 0 },
      { side: "old", docLine: 1 },
      { side: "new", docLine: 1 },
      { side: "new", docLine: 2 },
    ]);
  });

  it("produces empty streams for one-sided patches", () => {
    const hunks = parseUnifiedDiff("@@ -0,0 +1 @@\n+only");
    const result = buildFragmentTokenTargets(hunks);
    expect(result.oldText).toBe("");
    expect(result.newText).toBe("only");
  });
});
