import type { DiffHunk } from "@/utils/parse-unified-diff";
import type { DiffViewMode } from "@/utils/stored-diff-view-mode";
import { buildSplitDiffRows, type SplitDiffRow } from "@/utils/build-split-diff-rows";
import type { RenderChunk } from "@/utils/build-render-chunks";

export interface LazyRenderChunkCollection {
  readonly chunkCount: number;
  readonly totalRows: number;
  get(index: number): RenderChunk | undefined;
  visibleUpTo(renderLimit: number): RenderChunk[];
  builtCount(): number;
}

interface ChunkMeta {
  key: string;
  startIndex: number;
  hunkIndex: number;
  hunkRowOffset: number;
  chunkLength: number;
  header: string | null;
}

// Mirror of buildSplitDiffRows' pairing math, allocations excluded: counts how
// many side-by-side rows a hunk produces without materializing them. The lazy
// collection uses this to precompute chunk boundaries up front (so startIndex
// and length are known without building any chunk), then defers the actual
// SplitDiffRow[] construction until a chunk intersecting the visible range is
// requested. Must stay byte-for-byte consistent with buildSplitDiffRows'
// flush/pair algorithm — see parity test in the test file.
export const countSplitRowsForHunk = (hunk: DiffHunk): number => {
  let count = 0;
  let pendingDeletions = 0;
  let pendingAdditions = 0;
  const flush = () => {
    count += Math.max(pendingDeletions, pendingAdditions);
    pendingDeletions = 0;
    pendingAdditions = 0;
  };
  for (const line of hunk.lines) {
    if (line.type === "del") {
      pendingDeletions += 1;
      continue;
    }
    if (line.type === "add") {
      pendingAdditions += 1;
      continue;
    }
    flush();
    count += 1;
  }
  flush();
  return count;
};

export const buildLazyRenderChunks = (
  hunks: readonly DiffHunk[],
  viewMode: DiffViewMode,
  chunkSize: number,
): LazyRenderChunkCollection => {
  const chunkMetas: ChunkMeta[] = [];
  let startIndex = 0;
  let chunkOrdinal = 0;

  for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
    const hunk = hunks[hunkIndex];
    const hunkRowTotal = viewMode === "unified" ? hunk.lines.length : countSplitRowsForHunk(hunk);
    let hunkRowOffset = 0;
    do {
      const chunkLength = Math.min(chunkSize, hunkRowTotal - hunkRowOffset);
      chunkMetas.push({
        key: `c${chunkOrdinal}`,
        startIndex,
        hunkIndex,
        hunkRowOffset,
        chunkLength,
        header: hunkRowOffset === 0 ? hunk.header : null,
      });
      chunkOrdinal += 1;
      startIndex += chunkLength;
      hunkRowOffset += chunkLength;
    } while (hunkRowOffset < hunkRowTotal);
  }

  const chunkCache = new Map<number, RenderChunk>();
  // Split-mode rows are built at most once per hunk (and only for hunks whose
  // chunks a caller actually requests) — kept out of chunkCache so multi-chunk
  // hunks share the same row array instead of each chunk's slice re-pairing.
  const splitRowsCache = new Map<number, SplitDiffRow[]>();

  const buildChunk = (meta: ChunkMeta): RenderChunk => {
    const hunk = hunks[meta.hunkIndex];
    if (viewMode === "unified") {
      return {
        mode: "unified",
        key: meta.key,
        header: meta.header,
        lines: hunk.lines.slice(meta.hunkRowOffset, meta.hunkRowOffset + meta.chunkLength),
        startIndex: meta.startIndex,
      };
    }
    let rows = splitRowsCache.get(meta.hunkIndex);
    if (rows === undefined) {
      rows = buildSplitDiffRows(hunk);
      splitRowsCache.set(meta.hunkIndex, rows);
    }
    return {
      mode: "split",
      key: meta.key,
      header: meta.header,
      rows: rows.slice(meta.hunkRowOffset, meta.hunkRowOffset + meta.chunkLength),
      startIndex: meta.startIndex,
    };
  };

  const get = (index: number): RenderChunk | undefined => {
    const cached = chunkCache.get(index);
    if (cached !== undefined) return cached;
    const meta = chunkMetas[index];
    if (meta === undefined) return undefined;
    const chunk = buildChunk(meta);
    chunkCache.set(index, chunk);
    return chunk;
  };

  // First-paint simulation: chunks whose startIndex precedes the render limit.
  // chunkMetas is in ascending startIndex order, so walking until the first
  // out-of-window chunk builds only the chunks the viewport would mount.
  const visibleUpTo = (renderLimit: number): RenderChunk[] => {
    if (renderLimit <= 0) return [];
    const chunks: RenderChunk[] = [];
    for (let index = 0; index < chunkMetas.length; index += 1) {
      if (chunkMetas[index].startIndex >= renderLimit) break;
      const chunk = get(index);
      if (chunk !== undefined) chunks.push(chunk);
    }
    return chunks;
  };

  const builtCount = (): number => chunkCache.size;

  return {
    chunkCount: chunkMetas.length,
    totalRows: startIndex,
    get,
    visibleUpTo,
    builtCount,
  };
};
