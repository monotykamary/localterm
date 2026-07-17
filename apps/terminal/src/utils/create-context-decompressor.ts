// Persistent Brotli decompressor for the context-takeover mode ("br-ctx"). One
// per PTY (created on the {compress} frame, released on {session} or teardown).
// The DecompressionStream doesn't end per frame, so a concurrent reader runs for
// the socket's lifetime pushing decoded bytes into a buffer; each decompress()
// feeds a compressed chunk and waits for `rawSize` bytes (the size-delimited
// frame boundary — the decoder emits in arbitrary 16KB chunks, so the raw-size
// bound, not a read() boundary, recovers the frame).
export const createContextDecompressor = () => {
  const stream = new DecompressionStream("br" as CompressionFormat);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let bufferedLength = 0;
  let waitingForLength = 0;
  let resolveWaitingDecompress: (() => void) | null = null;
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          bufferedLength += value.length;
        }
        if (resolveWaitingDecompress !== null && bufferedLength >= waitingForLength) {
          const resolve = resolveWaitingDecompress;
          resolveWaitingDecompress = null;
          resolve();
        }
      }
    } catch {
      /* the no-finish close error at socket teardown — ignore */
    }
  })();
  const decompress = async (
    compressed: Uint8Array<ArrayBuffer>,
    rawSize: number,
  ): Promise<Uint8Array> => {
    await writer.write(compressed);
    if (bufferedLength < rawSize) {
      waitingForLength = rawSize;
      await new Promise<void>((resolve) => {
        resolveWaitingDecompress = resolve;
      });
    }
    const output = new Uint8Array(rawSize);
    let offset = 0;
    while (offset < rawSize) {
      const chunk = chunks[0];
      const requiredLength = rawSize - offset;
      if (chunk.length <= requiredLength) {
        output.set(chunk, offset);
        offset += chunk.length;
        chunks.shift();
        bufferedLength -= chunk.length;
      } else {
        output.set(chunk.subarray(0, requiredLength), offset);
        chunks[0] = chunk.subarray(requiredLength);
        offset = rawSize;
        bufferedLength -= requiredLength;
      }
    }
    return output;
  };
  const release = async () => {
    try {
      await writer.close();
    } catch {
      /* the persistent stream has no finish marker — the close errors */
    }
  };
  return { decompress, release };
};
