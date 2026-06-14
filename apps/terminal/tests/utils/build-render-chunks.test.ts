import { describe, expect, it } from "vite-plus/test";
import { buildRenderChunks, renderChunkLength } from "../../src/utils/build-render-chunks";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

describe("buildRenderChunks", () => {
  it("keeps a small hunk in a single chunk with its header", () => {
    const hunks = parseUnifiedDiff("@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n");
    const chunks = buildRenderChunks(hunks, "unified", 2000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].mode).toBe("unified");
    expect(chunks[0].header).toBe("@@ -1,3 +1,3 @@");
    expect(chunks[0].startIndex).toBe(0);
    expect(renderChunkLength(chunks[0])).toBe(4);
  });

  it("splits a hunk longer than the chunk size, header only on the first chunk", () => {
    const hunks = parseUnifiedDiff("@@ -0,0 +1,5 @@\n+a\n+b\n+c\n+d\n+e\n");
    const chunks = buildRenderChunks(hunks, "unified", 2);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.header)).toEqual(["@@ -0,0 +1,5 @@", null, null]);
    expect(chunks.map((chunk) => chunk.startIndex)).toEqual([0, 2, 4]);
    expect(chunks.map(renderChunkLength)).toEqual([2, 2, 1]);
    // Stable, unique keys for React reconciliation.
    expect(new Set(chunks.map((chunk) => chunk.key)).size).toBe(3);
    const first = chunks[0];
    if (first.mode === "unified") {
      expect(first.lines.map((line) => line.text)).toEqual(["a", "b"]);
    }
  });

  it("carries a header for the first chunk of each hunk and accumulates startIndex", () => {
    const hunks = parseUnifiedDiff("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -9,1 +9,1 @@\n-b\n+B\n");
    const chunks = buildRenderChunks(hunks, "unified", 2000);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.header)).toEqual(["@@ -1,1 +1,1 @@", "@@ -9,1 +9,1 @@"]);
    expect(chunks.map((chunk) => chunk.startIndex)).toEqual([0, 2]);
  });

  it("pairs split rows per full hunk before slicing across a chunk boundary", () => {
    // A deletion run + addition run spanning the boundary must stay paired —
    // chunking happens on already-paired rows, never on raw lines.
    const hunks = parseUnifiedDiff("@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n");
    const chunks = buildRenderChunks(hunks, "split", 1);
    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.header)).toEqual(["@@ -1,2 +1,2 @@", null]);
    const rows = chunks.flatMap((chunk) => (chunk.mode === "split" ? chunk.rows : []));
    expect(rows.map((row) => [row.left?.text, row.right?.text])).toEqual([
      ["a", "A"],
      ["b", "B"],
    ]);
  });
});
