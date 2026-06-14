import { buildSplitDiffRows, type SplitDiffRow } from "@/utils/build-split-diff-rows";
import type { DiffHunk, DiffLine } from "@/utils/parse-unified-diff";
import type { DiffViewMode } from "@/utils/stored-diff-view-mode";

// A fixed-size, referentially-stable slice of a file's rendered rows. Chunks are
// derived from the parsed hunks alone (never from how many are currently shown),
// so progressive rendering just mounts more of them and already-mounted chunks
// keep identical props — keeping the grow O(chunk), not O(total). `startIndex` is
// the cumulative row count before this chunk, used to decide which chunks are
// within the current render limit.
export type RenderChunk =
  | { mode: "unified"; key: string; header: string | null; lines: DiffLine[]; startIndex: number }
  | { mode: "split"; key: string; header: string | null; rows: SplitDiffRow[]; startIndex: number };

export const renderChunkLength = (chunk: RenderChunk): number =>
  chunk.mode === "unified" ? chunk.lines.length : chunk.rows.length;

// Split rows are paired per *full hunk* before slicing, so a deletion/addition
// run never mis-aligns across a chunk boundary. A hunk longer than chunkSize
// (e.g. one giant generated-file hunk) is split into several chunks; the hunk
// header rides on the first.
export const buildRenderChunks = (
  hunks: readonly DiffHunk[],
  viewMode: DiffViewMode,
  chunkSize: number,
): RenderChunk[] => {
  const chunks: RenderChunk[] = [];
  let startIndex = 0;
  let seq = 0;
  for (const hunk of hunks) {
    if (viewMode === "split") {
      const rows = buildSplitDiffRows(hunk);
      let offset = 0;
      do {
        const slice = rows.slice(offset, offset + chunkSize);
        chunks.push({
          mode: "split",
          key: `c${seq}`,
          header: offset === 0 ? hunk.header : null,
          rows: slice,
          startIndex,
        });
        seq += 1;
        startIndex += slice.length;
        offset += slice.length;
      } while (offset < rows.length);
    } else {
      let offset = 0;
      do {
        const slice = hunk.lines.slice(offset, offset + chunkSize);
        chunks.push({
          mode: "unified",
          key: `c${seq}`,
          header: offset === 0 ? hunk.header : null,
          lines: slice,
          startIndex,
        });
        seq += 1;
        startIndex += slice.length;
        offset += slice.length;
      } while (offset < hunk.lines.length);
    }
  }
  return chunks;
};
