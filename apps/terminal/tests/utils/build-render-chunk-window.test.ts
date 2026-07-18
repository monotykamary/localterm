import { describe, expect, it } from "vite-plus/test";
import { buildRenderChunkWindow } from "../../src/utils/build-render-chunk-window";
import { buildRenderChunks } from "../../src/utils/build-render-chunks";
import { parseUnifiedDiff } from "../../src/utils/parse-unified-diff";

const RENDER_CHUNK_SIZE = 2;
const INITIAL_RENDER_LIMIT = 2;

describe("buildRenderChunkWindow", () => {
  it("selects only first-paint chunks and counts the hidden tail", () => {
    const hunks = parseUnifiedDiff("@@ -0,0 +1,5 @@\n+a\n+b\n+c\n+d\n+e\n");
    const chunks = buildRenderChunks(hunks, "unified", RENDER_CHUNK_SIZE);

    const initialWindow = buildRenderChunkWindow(chunks, INITIAL_RENDER_LIMIT);

    expect(initialWindow.visibleChunks.map((chunk) => chunk.key)).toEqual(["c0"]);
    expect(initialWindow.totalRows).toBe(5);
    expect(initialWindow.hiddenRows).toBe(3);

    const completeWindow = buildRenderChunkWindow(chunks, Number.POSITIVE_INFINITY);
    expect(completeWindow.visibleChunks).toHaveLength(chunks.length);
    expect(completeWindow.hiddenRows).toBe(0);
  });
});
