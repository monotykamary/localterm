export const decompressFrame = async (
  format: string,
  compressed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array> => {
  const stream = new DecompressionStream(format as CompressionFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  // Read concurrently with the write+close: writer.close() waits for the
  // readable to drain, so the reader must already be pulling or a large frame
  // backpressures the transform and deadlocks the close.
  const drained = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  })();
  await writer.write(compressed);
  await writer.close();
  await drained;
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
};
