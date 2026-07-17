import type { CompressMode } from "@monotykamary/localterm-server/protocol";

import {
  WS_OUTPUT_BROTLI,
  WS_OUTPUT_BROTLI_CTX,
  WS_OUTPUT_CTX_HEADER_BYTES,
  WS_OUTPUT_GZIP,
  WS_OUTPUT_RAW,
} from "@/lib/constants";
import { createContextDecompressor } from "@/utils/create-context-decompressor";
import { decompressFrame } from "@/utils/decompress-frame";

interface CreateTerminalOutputSessionOptions {
  onOutput: (bytes: Uint8Array) => void;
  onReplay: (chunks: Uint8Array[], onComplete: () => void) => void;
  onReplayComplete: () => void;
}

export interface TerminalOutputSession {
  beginSession: () => void;
  beginReplay: () => void;
  finishReplay: () => void;
  handleBinaryMessage: (data: ArrayBuffer) => void;
  isSuppressingOutput: () => boolean;
  setCompressMode: (mode: CompressMode) => void;
}

export const createTerminalOutputSession = ({
  onOutput,
  onReplay,
  onReplayComplete,
}: CreateTerminalOutputSessionOptions): TerminalOutputSession => {
  // Decompression is async (DecompressionStream), so serialize per socket:
  // frames must reach xterm in PTY order, and the replay-end flush must wait
  // for the replay frames' decompresses. A promise chain (FIFO). ptyGeneration
  // invalidates pending decompresses when a {session} frame switches PTYs —
  // a prior PTY's frame still in the queue would otherwise land in the new
  // PTY (after terminal.reset()).
  let decompressQueue: Promise<void> = Promise.resolve();
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
  let replayChunks: Uint8Array[] = [];
  let suppressOutput = false;

  const enqueueDecompress = (task: () => Promise<void> | void): void => {
    decompressQueue = decompressQueue.then(task).catch((error: unknown) => {
      console.warn("[localterm] output decompress error", error);
    });
  };

  const releaseContextDecompressor = () => {
    if (contextDecompressor !== null) {
      void contextDecompressor.release();
      contextDecompressor = null;
    }
  };

  const flushReplay = () => {
    const chunks = replayChunks;
    inReplay = false;
    replayChunks = [];
    if (chunks.length === 0) {
      suppressOutput = false;
    } else {
      onReplay(chunks, () => {
        suppressOutput = false;
        onReplayComplete();
      });
    }
  };

  return {
    beginSession: () => {
      ptyGeneration += 1;
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
      replayChunks = [];
      suppressOutput = false;
    },
    beginReplay: () => {
      inReplay = true;
      suppressOutput = true;
      replayChunks = [];
    },
    finishReplay: () => {
      // Compressed replay frames are decompressed async (the per-socket
      // queue); the flush must wait for them or it'd write an incomplete
      // block. Raw mode (no compression) flushes inline — the frames
      // arrived synchronously and the flush must land before the next
      // (inline) live frame reads `inReplay`.
      if (negotiatedCompressMode === null) flushReplay();
      else enqueueDecompress(flushReplay);
    },
    handleBinaryMessage: (messageData) => {
      const data = new Uint8Array(messageData);
      if (negotiatedCompressMode === null) {
        // Raw passthrough (no compression — a no-DecompressionStream browser,
        // or an old server that never sent a {compress} frame): no header byte.
        if (inReplay) {
          replayChunks.push(data);
          return;
        }
        onOutput(data);
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
      enqueueDecompress(async () => {
        const header = data[0];
        let bytes: Uint8Array;
        if (header === WS_OUTPUT_BROTLI_CTX) {
          const rawSize = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
            1,
            true,
          );
          const compressed = data.subarray(WS_OUTPUT_CTX_HEADER_BYTES);
          bytes = await contextDecompressor!.decompress(compressed, rawSize);
        } else {
          const payload = data.subarray(1);
          if (header === WS_OUTPUT_BROTLI) bytes = await decompressFrame("br", payload);
          else if (header === WS_OUTPUT_GZIP) bytes = await decompressFrame("gzip", payload);
          else if (header === WS_OUTPUT_RAW) bytes = payload;
          else return;
        }
        if (ptyGeneration !== generationAtEnqueue) return;
        if (inReplay) {
          // Buffer the DECOMPRESSED bytes; replay-end writes them as one
          // suppressed block (dropping xterm's stale query responses).
          replayChunks.push(bytes);
          return;
        }
        onOutput(bytes);
      });
    },
    isSuppressingOutput: () => suppressOutput,
    setCompressMode: (mode) => {
      // The server's chosen compress mode, sent on promote BEFORE the
      // scrollback replay so the client knows how to parse the compressed
      // replay frames. Drives the binary handler (NOT COMPRESS_MODE — that's
      // the client's advertisement). An old server that doesn't know "br-ctx"
      // never sends this frame, so negotiatedCompressMode stays null and the
      // binary handler reads frames as raw (no header) — graceful degrade.
      negotiatedCompressMode = mode;
      releaseContextDecompressor();
      if (mode === "br-ctx") contextDecompressor = createContextDecompressor();
    },
  };
};
