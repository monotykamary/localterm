import { describe, expect, it } from "vite-plus/test";
import { buildSplitDiffRows } from "../../src/utils/build-split-diff-rows";
import {
  buildRenderChunks,
  renderChunkLength,
  type RenderChunk,
} from "../../src/utils/build-render-chunks";
import {
  buildLazyRenderChunks,
  countSplitRowsForHunk,
} from "../../src/utils/build-lazy-render-chunks";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

const CHUNK_SIZE = 2;

const chunkEquals = (actual: RenderChunk, expected: RenderChunk): boolean => {
  if (actual.mode !== expected.mode) return false;
  if (actual.key !== expected.key) return false;
  if (actual.header !== expected.header) return false;
  if (actual.startIndex !== expected.startIndex) return false;
  if (actual.mode === "unified" && expected.mode === "unified") {
    return (
      actual.lines.length === expected.lines.length &&
      actual.lines.every((line, index) => line === expected.lines[index])
    );
  }
  if (actual.mode === "split" && expected.mode === "split") {
    return (
      actual.rows.length === expected.rows.length &&
      actual.rows.every((row, index) => {
        const other = expected.rows[index];
        return row.left === other.left && row.right === other.right;
      })
    );
  }
  return false;
};

const expectLazyMatchesEager = (
  patch: string,
  viewMode: "unified" | "split",
  chunkSize = CHUNK_SIZE,
): void => {
  const hunks = parseUnifiedDiff(patch);
  const eager = buildRenderChunks(hunks, viewMode, chunkSize);
  const collection = buildLazyRenderChunks(hunks, viewMode, chunkSize);

  expect(collection.chunkCount).toBe(eager.length);
  const eagerTotalRows = eager.reduce((total, chunk) => total + renderChunkLength(chunk), 0);
  expect(collection.totalRows).toBe(eagerTotalRows);

  // Constructing collection metadata must not build any chunk.
  expect(collection.builtCount()).toBe(0);

  const lazyChunks = collection.visibleUpTo(Number.POSITIVE_INFINITY);
  expect(lazyChunks).toHaveLength(eager.length);
  for (let index = 0; index < eager.length; index += 1) {
    expect(chunkEquals(lazyChunks[index], eager[index])).toBe(true);
  }

  // Re-requesting the same chunk must hit the cache instead of rebuilding.
  const beforeSecondFetch = collection.builtCount();
  collection.get(0);
  expect(collection.builtCount()).toBe(beforeSecondFetch);
};

describe("buildLazyRenderChunks", () => {
  describe("equivalence with eager buildRenderChunks", () => {
    it("matches a single small hunk in unified mode", () => {
      expectLazyMatchesEager("@@ -1,3 +1,3 @@\n alpha\n-beta\n+BETA\n gamma\n", "unified");
    });

    it("matches a hunk longer than the chunk size", () => {
      expectLazyMatchesEager("@@ -0,0 +1,5 @@\n+a\n+b\n+c\n+d\n+e\n", "unified");
    });

    it("matches multiple hunks across startIndex boundaries", () => {
      expectLazyMatchesEager("@@ -1,1 +1,1 @@\n-a\n+A\n@@ -9,1 +9,1 @@\n-b\n+B\n", "unified");
    });

    it("matches split mode with paired delete/add runs spanning a chunk boundary", () => {
      // Two deletions followed by two additions, sliced at chunk size 2 — the
      // pairing must stay aligned across the boundary exactly as eager does.
      expectLazyMatchesEager("@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n", "split");
    });

    it("matches split mode with an unbalanced delete-then-add run", () => {
      expectLazyMatchesEager("@@ -1,3 +1,2 @@\n x\n-y\n-z\n+w\n", "split");
    });

    it("matches a large multi-hunk diff", () => {
      const hunks = Array.from({ length: 40 }, (_, hunkIndex) =>
        [
          `@@ -${hunkIndex * 50 + 1},50 +${hunkIndex * 50 + 1},50 @@`,
          ...Array.from({ length: 50 }, (_, lineIndex) => ` context ${hunkIndex}-${lineIndex}`),
          `-removed ${hunkIndex}`,
          `+added ${hunkIndex}`,
        ].join("\n"),
      ).join("\n");
      expectLazyMatchesEager(hunks, "unified");
      expectLazyMatchesEager(hunks, "split");
    });

    it("matches an empty hunks array with zero chunks", () => {
      const collection = buildLazyRenderChunks([], "unified", CHUNK_SIZE);
      expect(collection.chunkCount).toBe(0);
      expect(collection.totalRows).toBe(0);
      expect(collection.visibleUpTo(100)).toEqual([]);
      expect(collection.get(0)).toBeUndefined();
    });
  });

  describe("laziness", () => {
    it("exposes totalRows and chunkCount without building any chunk", () => {
      const hunks = parseUnifiedDiff(
        "@@ -0,0 +1,100 @@\n" + Array.from({ length: 100 }, (_, i) => `+l${i}`).join("\n") + "\n",
      );
      const collection = buildLazyRenderChunks(hunks, "unified", CHUNK_SIZE);
      expect(collection.builtCount()).toBe(0);
      expect(collection.chunkCount).toBe(50);
      expect(collection.totalRows).toBe(100);
      expect(collection.builtCount()).toBe(0);
    });

    it("visibleUpTo builds only chunks inside the requested range", () => {
      const hunks = parseUnifiedDiff(
        "@@ -0,0 +1,100 @@\n" + Array.from({ length: 100 }, (_, i) => `+l${i}`).join("\n") + "\n",
      );
      const collection = buildLazyRenderChunks(hunks, "unified", CHUNK_SIZE);
      const firstWindow = collection.visibleUpTo(CHUNK_SIZE);
      expect(firstWindow).toHaveLength(1);
      expect(collection.builtCount()).toBe(1);

      const secondWindow = collection.visibleUpTo(CHUNK_SIZE * 3);
      expect(secondWindow).toHaveLength(3);
      expect(collection.builtCount()).toBe(3);
    });

    it("visibleUpTo with non-positive limit returns no chunks and builds nothing", () => {
      const hunks = parseUnifiedDiff("@@ -0,0 +1,4 @@\n+a\n+b\n+c\n+d\n");
      const collection = buildLazyRenderChunks(hunks, "unified", CHUNK_SIZE);
      expect(collection.visibleUpTo(0)).toEqual([]);
      expect(collection.builtCount()).toBe(0);
      expect(collection.visibleUpTo(-10)).toEqual([]);
      expect(collection.builtCount()).toBe(0);
    });

    it("split-mode hunks never requested do not pay buildSplitDiffRows", () => {
      // Three hunks: only the first chunk (hunk 0) is within the first-paint
      // limit. Split-mode row pairing for hunks 1 and 2 must stay deferred —
      // verified by the built-count delta (a paired hunk array would grow the
      // cache's backing map only via chunkCache, so builtCount reflects the
      // chunk, but splitRowsCache stays untouched for hunks 1/2).
      const patch = [
        "@@ -0,0 +1,2 @@\n+a1\n+a2",
        "@@ -2,0 +3,2 @@\n+b1\n+b2",
        "@@ -4,0 +5,2 @@\n+c1\n+c2",
      ].join("\n");
      const hunks = parseUnifiedDiff(patch);
      const collection = buildLazyRenderChunks(hunks, "split", CHUNK_SIZE);
      const visible = collection.visibleUpTo(CHUNK_SIZE);
      expect(visible).toHaveLength(1);
      expect(collection.builtCount()).toBe(1);
      // Force-build hunk 2 only; hunk 1 still unrequested.
      collection.get(2);
      expect(collection.builtCount()).toBe(2);
    });
  });

  describe("countSplitRowsForHunk parity with buildSplitDiffRows", () => {
    const shapes = [
      ["empty hunk", "@@ -0,0 +0,0 @@\n"],
      ["context only", "@@ -1,2 +1,2 @@\n x\n y\n"],
      ["balanced del/add", "@@ -1,2 +1,2 @@\n-a\n-b\n+A\n+B\n"],
      ["addition-heavy", "@@ -1,0 +1,3 @@\n+a\n+b\n+c\n"],
      ["deletion-heavy", "@@ -1,3 +1,0 @@\n-a\n-b\n-c\n"],
      ["interleaved runs", "@@ -1,7 +1,7 @@\n x\n-a\n+A\n y\n-b\n-c\n+B\n+C\n"],
    ] as const;

    for (const [label, patch] of shapes) {
      it(`counts the same rows as buildSplitDiffRows produces: ${label}`, () => {
        const hunks = parseUnifiedDiff(patch);
        for (const hunk of hunks) {
          expect(countSplitRowsForHunk(hunk)).toBe(buildSplitDiffRows(hunk).length);
        }
      });
    }
  });
});
