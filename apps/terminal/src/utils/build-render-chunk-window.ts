import { renderChunkLength, type RenderChunk } from "@/utils/build-render-chunks";

export interface RenderChunkWindow {
  readonly visibleChunks: RenderChunk[];
  readonly totalRows: number;
  readonly hiddenRows: number;
}

export const buildRenderChunkWindow = (
  renderChunks: readonly RenderChunk[],
  renderLimit: number,
): RenderChunkWindow => {
  const visibleChunks: RenderChunk[] = [];
  let totalRows = 0;
  let renderedRows = 0;

  for (const chunk of renderChunks) {
    const chunkLength = renderChunkLength(chunk);
    totalRows += chunkLength;
    if (chunk.startIndex < renderLimit) {
      visibleChunks.push(chunk);
      renderedRows += chunkLength;
    }
  }

  return {
    visibleChunks,
    totalRows,
    hiddenRows: totalRows - renderedRows,
  };
};
