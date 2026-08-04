import {
  MAX_OUTPUT_BYTES,
  WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES,
  type CompressMode,
} from "@monotykamary/localterm-server/protocol";

import {
  MAX_PIXEL_FRAME_PIXELS,
  WS_OUTPUT_BROTLI,
  WS_OUTPUT_BROTLI_CTX,
  WS_OUTPUT_CTX_HEADER_BYTES,
  WS_OUTPUT_FRAME_HEADER_BYTES,
  WS_OUTPUT_GZIP,
  WS_OUTPUT_PIXEL_FRAME,
  WS_OUTPUT_RAW,
} from "@/lib/constants";
import { createContextDecompressor } from "@/utils/create-context-decompressor";
import { decompressFrame } from "@/utils/decompress-frame";

interface CreateTerminalOutputSessionOptions {
  onOutput: (bytes: Uint8Array) => void;
  onOverflow: () => void;
  onReplay: (chunks: Uint8Array[], onComplete: () => void) => void;
  onReplayComplete: () => void;
  // Relayed pixel frames (kitty file-medium RGBA relayed by the daemon) routed
  // outside the terminal output path — never written into xterm.
  onPixelFrame?: (width: number, height: number, rgba: Uint8Array) => void;
}

export interface TerminalOutputSession {
  beginAtomicOutputFrame: () => void;
  beginSession: () => void;
  beginReplay: () => void;
  dispose: () => void;
  finishAtomicOutputFrame: () => void;
  finishReplay: () => void;
  handleBinaryMessage: (data: ArrayBuffer) => void;
  isSuppressingOutput: () => boolean;
  // Always-on binary framing: every binary WS message from the server carries a
  // 1-byte type header (0x00 raw output, 0x01–0x03 compressed output, 0x04
  // pixel frame). Confirmed by the server via its {binary-framing} control
  // message, only for clients that advertised it in {ready}.
  setBinaryFraming: (enabled: boolean) => void;
  setCompressMode: (mode: CompressMode) => void;
}

export const createTerminalOutputSession = ({
  onOutput,
  onOverflow,
  onReplay,
  onReplayComplete,
  onPixelFrame,
}: CreateTerminalOutputSessionOptions): TerminalOutputSession => {
  // Decompression is async (DecompressionStream), so serialize per socket:
  // frames must reach xterm in PTY order, and the replay-end flush must wait
  // for the replay frames' decompresses. A promise chain (FIFO). ptyGeneration
  // invalidates pending decompresses when a {session} frame switches PTYs —
  // a prior PTY's frame still in the queue would otherwise land in the new
  // PTY (after terminal.reset()).
  let decompressQueue: Promise<void> = Promise.resolve();
  let decompressQueueGeneration = 0;
  let queuedBytes = 0;
  let ptyGeneration = 0;
  // The server's chosen compress mode (from the {compress} frame on promote),
  // NOT the client's advertisement. null = raw (no header) — either a no-
  // support browser or an old server that never sent {compress}.
  let negotiatedCompressMode: CompressMode = null;
  // The persistent Brotli decompressor for "br-ctx" (one per PTY, reset on
  // {session} and {compress}); its LZ77 window holds the prior screen so each
  // frame decompresses as a delta.
  let contextDecompressor: ReturnType<typeof createContextDecompressor> | null = null;
  let inReplay = false;
  let replayBytes = 0;
  let replayChunks: Uint8Array[] = [];
  let atomicOutputFrameOpen = false;
  let atomicOutputFrameBytes = 0;
  let atomicOutputFrameChunks: Uint8Array[] = [];
  let suppressOutput = false;
  let disposed = false;
  // Server-confirmed always-on binary framing ({binary-framing} control). Raw
  // loopback sessions rely on this to separate the pixel-frame channel from
  // terminal output — without it a raw-mode message has no type byte.
  let binaryFramingEnabled = false;

  const releaseContextDecompressor = (): void => {
    if (contextDecompressor !== null) {
      void contextDecompressor.release();
      contextDecompressor = null;
    }
  };

  const resetDecompressQueue = (): void => {
    decompressQueueGeneration += 1;
    decompressQueue = Promise.resolve();
    queuedBytes = 0;
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    ptyGeneration += 1;
    resetDecompressQueue();
    releaseContextDecompressor();
    inReplay = false;
    replayBytes = 0;
    replayChunks = [];
    clearAtomicOutputFrame();
    suppressOutput = false;
  };

  const overflow = (): void => {
    if (disposed) return;
    try {
      onOverflow();
    } finally {
      dispose();
    }
  };

  const enqueueDecompress = (bytes: number, task: () => Promise<void> | void): void => {
    if (disposed) return;
    if (
      queuedBytes + replayBytes + atomicOutputFrameBytes + bytes >
      WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES
    ) {
      overflow();
      return;
    }
    const queueGenerationAtEnqueue = decompressQueueGeneration;
    queuedBytes += bytes;
    decompressQueue = decompressQueue
      .then(async () => {
        if (disposed || decompressQueueGeneration !== queueGenerationAtEnqueue) return;
        await task();
      })
      .catch((error: unknown) => {
        if (!disposed && decompressQueueGeneration === queueGenerationAtEnqueue) {
          console.warn("[localterm] output decompress error", error);
          overflow();
        }
      })
      .finally(() => {
        if (decompressQueueGeneration === queueGenerationAtEnqueue) {
          queuedBytes = Math.max(0, queuedBytes - bytes);
        }
      });
  };

  const clearAtomicOutputFrame = (): void => {
    atomicOutputFrameOpen = false;
    atomicOutputFrameBytes = 0;
    atomicOutputFrameChunks = [];
  };

  const retainAtomicOutputFrameChunk = (bytes: Uint8Array): boolean => {
    if (atomicOutputFrameBytes + bytes.byteLength > WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES) {
      overflow();
      return false;
    }
    atomicOutputFrameChunks.push(bytes);
    atomicOutputFrameBytes += bytes.byteLength;
    return true;
  };

  const retainReplayChunk = (bytes: Uint8Array): boolean => {
    if (replayBytes + bytes.byteLength > WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES) {
      overflow();
      return false;
    }
    replayChunks.push(bytes);
    replayBytes += bytes.byteLength;
    return true;
  };

  const handleOutputBytes = (bytes: Uint8Array): void => {
    if (inReplay) {
      retainReplayChunk(bytes);
    } else if (atomicOutputFrameOpen) {
      retainAtomicOutputFrameChunk(bytes);
    } else {
      onOutput(bytes);
    }
  };

  const flushAtomicOutputFrame = (): void => {
    if (disposed || !atomicOutputFrameOpen) return;
    const chunks = atomicOutputFrameChunks;
    const byteLength = atomicOutputFrameBytes;
    clearAtomicOutputFrame();
    if (chunks.length === 0) return;
    if (chunks.length === 1) {
      const chunk = chunks[0];
      if (chunk) onOutput(chunk);
      return;
    }
    const bytes = new Uint8Array(byteLength);
    let byteOffset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, byteOffset);
      byteOffset += chunk.byteLength;
    }
    onOutput(bytes);
  };

  const flushReplay = (): void => {
    if (disposed) return;
    const chunks = replayChunks;
    const generationAtFlush = ptyGeneration;
    inReplay = false;
    replayBytes = 0;
    replayChunks = [];
    if (chunks.length === 0) {
      suppressOutput = false;
    } else {
      onReplay(chunks, () => {
        if (disposed || generationAtFlush !== ptyGeneration) return;
        suppressOutput = false;
        onReplayComplete();
      });
    }
  };

  return {
    beginAtomicOutputFrame: () => {
      if (disposed) return;
      const beginFrame = (): void => {
        if (!disposed && !atomicOutputFrameOpen) atomicOutputFrameOpen = true;
      };
      if (negotiatedCompressMode === null && !binaryFramingEnabled) beginFrame();
      else enqueueDecompress(0, beginFrame);
    },
    beginSession: () => {
      if (disposed) return;
      ptyGeneration += 1;
      resetDecompressQueue();
      // A new session frame is a fresh attach: reset the negotiated compress
      // mode (the server sends a new {compress} frame on promote) and release
      // the prior PTY's persistent Brotli decompressor (its LZ77 context is
      // stale for the new PTY).
      negotiatedCompressMode = null;
      releaseContextDecompressor();
      // A new session frame means a fresh attach: drop any suppressed-replay
      // window left open by a prior (possibly failed) attach — its replay
      // is moot now, and an unbalanced window would leave onData suppressed
      // (a dead terminal). Re-opened below if this attach wants a replay.
      inReplay = false;
      replayBytes = 0;
      replayChunks = [];
      clearAtomicOutputFrame();
      suppressOutput = false;
    },
    beginReplay: () => {
      if (disposed) return;
      inReplay = true;
      suppressOutput = true;
      replayBytes = 0;
      replayChunks = [];
      clearAtomicOutputFrame();
    },
    dispose,
    finishAtomicOutputFrame: () => {
      if (disposed) return;
      if (negotiatedCompressMode === null && !binaryFramingEnabled) flushAtomicOutputFrame();
      else enqueueDecompress(0, flushAtomicOutputFrame);
    },
    finishReplay: () => {
      if (disposed) return;
      // Compressed replay frames are decompressed async (the per-socket
      // queue); the flush must wait for them or it'd write an incomplete
      // block. Raw mode (no compression) flushes inline — the frames
      // arrived synchronously and the flush must land before the next
      // (inline) live frame reads `inReplay`.
      if (negotiatedCompressMode === null && !binaryFramingEnabled) flushReplay();
      else enqueueDecompress(0, flushReplay);
    },
    handleBinaryMessage: (messageData) => {
      if (disposed) return;
      const data = new Uint8Array(messageData);
      if (data.byteLength > WS_OUTPUT_CLIENT_QUEUE_MAX_BYTES) {
        overflow();
        return;
      }
      // Pixel frames ride the always-on binary framing channel: messages whose
      // first byte is a type header. They exceed ordinary output caps (validated
      // against the pixel budget instead) and must never be written into xterm.
      if (binaryFramingEnabled && data[0] === WS_OUTPUT_PIXEL_FRAME) {
        if (data.byteLength < WS_OUTPUT_FRAME_HEADER_BYTES) return;
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const width = view.getUint32(1, true);
        const height = view.getUint32(5, true);
        if (
          width <= 0 ||
          height <= 0 ||
          width * height > MAX_PIXEL_FRAME_PIXELS ||
          width * height * 4 !== data.byteLength - WS_OUTPUT_FRAME_HEADER_BYTES
        ) {
          return;
        }
        onPixelFrame?.(width, height, data.subarray(WS_OUTPUT_FRAME_HEADER_BYTES));
        return;
      }
      if (negotiatedCompressMode === null && !binaryFramingEnabled) {
        // Raw passthrough (no compression — a no-DecompressionStream browser,
        // or an old server that never sent {compress} frame): no header byte.
        if (data.byteLength > MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        handleOutputBytes(data);
        return;
      }
      // Compressed frame. 0x00/0x01/0x02 use a 1-byte header (per-frame
      // independent — a fresh DecompressionStream per frame reads to done).
      // 0x03 is the context-takeover: a 5-byte header (0x03 + 4-byte LE raw
      // size) then the compressed payload, fed to the per-socket persistent
      // DecompressionStream and size-delimited by the raw size (the stream
      // doesn't end per frame). Decompress is async, so enqueue per socket —
      // frames reach xterm in PTY order and the replay-end flush waits for
      // the replay frames' decompresses. Capture the PTY generation so a
      // {session} switch drops a prior PTY's frame still mid-decompress.
      const generationAtEnqueue = ptyGeneration;
      enqueueDecompress(data.byteLength, async () => {
        const header = data[0];
        let bytes: Uint8Array;
        if (header === WS_OUTPUT_BROTLI_CTX) {
          if (data.byteLength < WS_OUTPUT_CTX_HEADER_BYTES) return;
          const rawSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
            1,
            true,
          );
          if (rawSize <= 0 || rawSize > MAX_OUTPUT_BYTES) {
            overflow();
            return;
          }
          const decompressor = contextDecompressor;
          if (!decompressor) return;
          const compressed = data.subarray(WS_OUTPUT_CTX_HEADER_BYTES);
          bytes = await decompressor.decompress(compressed, rawSize);
        } else {
          const payload = data.subarray(1);
          if (header === WS_OUTPUT_BROTLI) bytes = await decompressFrame("br", payload);
          else if (header === WS_OUTPUT_GZIP) bytes = await decompressFrame("gzip", payload);
          else if (header === WS_OUTPUT_RAW) bytes = payload;
          else return;
        }
        if (bytes.byteLength > MAX_OUTPUT_BYTES) {
          overflow();
          return;
        }
        if (disposed || ptyGeneration !== generationAtEnqueue) return;
        handleOutputBytes(bytes);
      });
    },
    isSuppressingOutput: () => suppressOutput,
    setBinaryFraming: (enabled) => {
      if (disposed) return;
      binaryFramingEnabled = enabled;
    },
    setCompressMode: (mode) => {
      if (disposed) return;
      // The server's chosen compress mode, sent on promote BEFORE the
      // scrollback replay so the client knows how to parse the compressed
      // replay frames. Drives the binary handler (NOT COMPRESS_MODE — that's
      // the client's advertisement). An old server that doesn't know "br-ctx"
      // never sends this frame, so negotiatedCompressMode stays null and the
      // binary handler reads frames as raw (no header) — graceful degrade.
      ptyGeneration += 1;
      resetDecompressQueue();
      negotiatedCompressMode = mode;
      releaseContextDecompressor();
      if (mode === "br-ctx") contextDecompressor = createContextDecompressor();
    },
  };
};
