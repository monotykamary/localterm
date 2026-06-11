import { describe, expect, it } from "vite-plus/test";
import { countHunkLines, parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

const SIMPLE_PATCH = [
  "diff --git a/file.ts b/file.ts",
  "index 1111111..2222222 100644",
  "--- a/file.ts",
  "+++ b/file.ts",
  "@@ -1,3 +1,3 @@",
  " alpha",
  "-beta",
  "+BETA",
  " gamma",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("parses a single hunk with context, deletion, and addition", () => {
    const hunks = parseUnifiedDiff(SIMPLE_PATCH);
    expect(hunks).toHaveLength(1);
    expect(hunks[0].header).toBe("@@ -1,3 +1,3 @@");
    expect(hunks[0].lines).toEqual([
      { type: "context", text: "alpha", oldLine: 1, newLine: 1, noNewline: false },
      { type: "del", text: "beta", oldLine: 2, newLine: null, noNewline: false },
      { type: "add", text: "BETA", oldLine: null, newLine: 2, noNewline: false },
      { type: "context", text: "gamma", oldLine: 3, newLine: 3, noNewline: false },
    ]);
  });

  it("tracks line numbers across multiple hunks", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      "-one",
      "+ONE",
      " two",
      "@@ -10,2 +10,3 @@",
      " ten",
      "+ten-and-a-half",
      " eleven",
      "",
    ].join("\n");
    const hunks = parseUnifiedDiff(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[1].lines[0]).toEqual({
      type: "context",
      text: "ten",
      oldLine: 10,
      newLine: 10,
      noNewline: false,
    });
    expect(hunks[1].lines[1]).toEqual({
      type: "add",
      text: "ten-and-a-half",
      oldLine: null,
      newLine: 11,
      noNewline: false,
    });
    expect(hunks[1].lines[2]).toEqual({
      type: "context",
      text: "eleven",
      oldLine: 11,
      newLine: 12,
      noNewline: false,
    });
  });

  it("handles hunk headers without a count (single-line ranges)", () => {
    const hunks = parseUnifiedDiff("@@ -1 +1 @@\n-a\n+b\n");
    expect(hunks[0].lines).toEqual([
      { type: "del", text: "a", oldLine: 1, newLine: null, noNewline: false },
      { type: "add", text: "b", oldLine: null, newLine: 1, noNewline: false },
    ]);
  });

  it("attaches the no-newline marker to the preceding line", () => {
    const patch = "@@ -1 +1 @@\n-old\n+new\n\\ No newline at end of file\n";
    const hunks = parseUnifiedDiff(patch);
    expect(hunks[0].lines[1].noNewline).toBe(true);
    expect(hunks[0].lines[0].noNewline).toBe(false);
  });

  it("ignores file headers and returns no hunks for header-only patches", () => {
    const headerOnly = [
      "diff --git a/old.ts b/new.ts",
      "similarity index 100%",
      "rename from old.ts",
      "rename to new.ts",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(headerOnly)).toEqual([]);
  });

  it("preserves leading whitespace in line text", () => {
    const hunks = parseUnifiedDiff("@@ -1 +1 @@\n-\tindented\n+    spaced\n");
    expect(hunks[0].lines[0].text).toBe("\tindented");
    expect(hunks[0].lines[1].text).toBe("    spaced");
  });

  it("treats a fully empty in-hunk line as empty context", () => {
    const hunks = parseUnifiedDiff("@@ -1,2 +1,2 @@\n\n-x\n+y\n");
    expect(hunks[0].lines[0]).toEqual({
      type: "context",
      text: "",
      oldLine: 1,
      newLine: 1,
      noNewline: false,
    });
  });
});

describe("countHunkLines", () => {
  it("sums lines across hunks", () => {
    const hunks = parseUnifiedDiff(SIMPLE_PATCH);
    expect(countHunkLines(hunks)).toBe(4);
    expect(countHunkLines([])).toBe(0);
  });
});
