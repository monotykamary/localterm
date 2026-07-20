import { MAX_OUTPUT_BYTES } from "@monotykamary/localterm-server/protocol";

interface ContextDecompressWaitState {
  requiredLength: number;
  resolve: (() => void) | null;
}

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
  let readerError: Error | null = null;
  let released = false;
  const waitState: ContextDecompressWaitState = { requiredLength: 0, resolve: null };
  const readerTask = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (!released) readerError = new Error("Brotli stream ended before its frame completed");
          break;
        }
        if (value) {
          chunks.push(value);
          bufferedLength += value.length;
        }
        if (
          waitState.requiredLength > 0 &&
          (bufferedLength >= waitState.requiredLength || bufferedLength > MAX_OUTPUT_BYTES)
        ) {
          const resolveWaitingDecompress = waitState.resolve;
          waitState.resolve = null;
          resolveWaitingDecompress?.();
        }
      }
    } catch (error) {
      if (!released) {
        readerError = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      const resolveWaitingDecompress = waitState.resolve;
      waitState.resolve = null;
      resolveWaitingDecompress?.();
    }
  })();

  const decompress = async (
    compressed: Uint8Array<ArrayBuffer>,
    rawSize: number,
  ): Promise<Uint8Array> => {
    if (released) throw new Error("Brotli decompressor released");
    if (!Number.isSafeInteger(rawSize) || rawSize <= 0 || rawSize > MAX_OUTPUT_BYTES) {
      throw new Error("Invalid Brotli frame size");
    }
    waitState.requiredLength = rawSize;
    await writer.write(compressed);
    if (bufferedLength < rawSize && readerError === null) {
      await new Promise<void>((resolve) => {
        waitState.resolve = resolve;
      });
    }
    if (released) throw new Error("Brotli decompressor released");
    if (readerError) throw readerError;
    if (bufferedLength !== rawSize) throw new Error("Brotli frame size mismatch");

    const output = new Uint8Array(rawSize);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;
    bufferedLength = 0;
    waitState.requiredLength = 0;
    return output;
  };

  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    const resolveWaitingDecompress = waitState.resolve;
    waitState.resolve = null;
    resolveWaitingDecompress?.();
    await Promise.allSettled([writer.abort(), reader.cancel(), readerTask]);
    chunks.length = 0;
    bufferedLength = 0;
  };

  return { decompress, release };
};
