import zlib from "node:zlib";
import {
  MAX_OUTPUT_BYTES,
  WS_BACKPRESSURE_THRESHOLD_BYTES,
  WS_CLOSE_BACKPRESSURE,
  WS_OUTPUT_BROTLI,
  WS_OUTPUT_BROTLI_CTX,
  WS_OUTPUT_BROTLI_QUALITY,
  WS_OUTPUT_COMPRESS_THRESHOLD_BYTES,
  WS_OUTPUT_CTX_HEADER_BYTES,
  WS_OUTPUT_FRAME_HEADER_BYTES,
  WS_OUTPUT_GZIP,
  WS_OUTPUT_GZIP_LEVEL,
  WS_OUTPUT_PIXEL_FRAME,
  WS_OUTPUT_RAW,
  WS_PENDING_CLIENT_MAX_BYTES,
  WS_PENDING_CLIENT_MAX_CONTROL_MESSAGES,
  WS_READY_STATE_OPEN,
} from "./constants.js";
import type { ManagedClient, ManagedSession } from "./session-manager.js";
import type { ServerToClientMessage } from "./types.js";
import { getBufferedAmount, type ClientSocket } from "./utils/ws-socket.js";

// Persistent Brotli compressor for the context-takeover mode ("br-ctx"). Each
// output frame is flushed as a chunk of ONE continuous Brotli stream, so frame N
// compresses against frames 0..N-1 (the prior screen primes the LZ77 window —
// the delta). Per-client, created on promote, released on detach. The flushes
// are chained (a per-encoder FIFO) so frames compress + ship in PTY order even
// though each flush is async (the BROTLI_OPERATION_FLUSH callback fires on the
// next tick). The accumulator is trimmed after each flush so a long session
// doesn't grow without bound.
export interface BrotliEncoder {
  enqueue: <Result>(
    task: () => Promise<Result> | Result,
    queuedByteLength?: number,
  ) => Promise<Result>;
  flush: (
    bytes: Uint8Array<ArrayBuffer>,
    onCompressed?: (compressed: Buffer<ArrayBuffer>) => void,
  ) => Promise<Buffer<ArrayBuffer>>;
  queuedBytes: () => number;
  release: () => void;
}

export const makeBrotliEncoder = (level: number): BrotliEncoder => {
  const encoder = zlib.createBrotliCompress({
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
  });
  let outputChunks: Buffer[] = [];
  let outputBytes = 0;
  let pendingBytes = 0;
  let released = false;
  let tail: Promise<void> = Promise.resolve();

  encoder.on("data", (chunk: Buffer) => {
    outputChunks.push(chunk);
    outputBytes += chunk.length;
  });

  const compress = (bytes: Uint8Array<ArrayBuffer>): Promise<Buffer<ArrayBuffer>> =>
    new Promise((resolve, reject) => {
      if (released) {
        reject(new Error("Brotli encoder released"));
        return;
      }
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        encoder.off("error", onError);
        encoder.off("close", onClose);
        if (error) {
          reject(error);
          return;
        }
        const output = Buffer.concat(outputChunks, outputBytes);
        outputChunks = [];
        outputBytes = 0;
        resolve(output);
      };
      const onError = (error: Error): void => finish(error);
      const onClose = (): void => finish(new Error("Brotli encoder closed"));
      encoder.once("error", onError);
      encoder.once("close", onClose);
      try {
        encoder.write(bytes);
        encoder.flush(zlib.constants.BROTLI_OPERATION_FLUSH, () => {
          setImmediate(() => finish(released ? new Error("Brotli encoder released") : undefined));
        });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });

  const enqueue = <Result>(
    task: () => Promise<Result> | Result,
    queuedByteLength = 0,
  ): Promise<Result> => {
    if (released) return Promise.reject(new Error("Brotli encoder released"));
    pendingBytes += queuedByteLength;
    const result = tail.then(() => {
      if (released) throw new Error("Brotli encoder released");
      return task();
    });
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result.finally(() => {
      pendingBytes = Math.max(0, pendingBytes - queuedByteLength);
    });
  };

  const flush = (
    bytes: Uint8Array<ArrayBuffer>,
    onCompressed?: (compressed: Buffer<ArrayBuffer>) => void,
  ): Promise<Buffer<ArrayBuffer>> =>
    enqueue(async () => {
      const compressed = await compress(bytes);
      onCompressed?.(compressed);
      return compressed;
    }, bytes.byteLength);

  const release = (): void => {
    if (released) return;
    released = true;
    outputChunks = [];
    outputBytes = 0;
    try {
      encoder.destroy();
    } catch {
      return;
    }
  };

  return { enqueue, flush, queuedBytes: () => pendingBytes, release };
};

export class SessionOutputTransport {
  private readonly sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void;

  constructor(sendControl: (ws: ClientSocket, payload: ServerToClientMessage) => void) {
    this.sendControl = sendControl;
  }

  async sendScrollback(
    ws: ClientSocket,
    managed: ManagedSession,
    client: ManagedClient,
  ): Promise<void> {
    const snapshot = managed.session.snapshotScrollback();
    if (!snapshot) return;
    const bytes = Buffer.from(snapshot, "utf8");
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
      await this.sendOutputFrame(ws, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES), client);
    }
  }

  private sendOutputBytes(ws: ClientSocket, bytes: Uint8Array<ArrayBuffer>): void {
    if (ws.readyState !== WS_READY_STATE_OPEN) return;
    if (getBufferedAmount(ws) > WS_BACKPRESSURE_THRESHOLD_BYTES) {
      ws.close(WS_CLOSE_BACKPRESSURE, "backpressure");
      return;
    }
    try {
      ws.send(bytes);
    } catch {
      /* socket closed between readyState check and send */
    }
  }

  private compressPayload(
    bytes: Uint8Array<ArrayBuffer>,
    mode: "br" | "gzip",
  ): Buffer<ArrayBuffer> {
    return mode === "br"
      ? zlib.brotliCompressSync(bytes, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: WS_OUTPUT_BROTLI_QUALITY },
        })
      : zlib.gzipSync(bytes, { level: WS_OUTPUT_GZIP_LEVEL });
  }

  private frameWithHeader(header: number, payload: Uint8Array<ArrayBuffer>): Buffer<ArrayBuffer> {
    const out = Buffer.allocUnsafe(1 + payload.length);
    out[0] = header;
    out.set(payload, 1);
    return out;
  }

  // 5-byte header for the context-takeover mode: 0x03 + 4-byte LE raw size, so
  // the client can size-delimit a frame out of the persistent DecompressionStream
  // (which doesn't end per frame and emits in arbitrary 16KB chunks).
  private frameWithCtxHeader(
    compressed: Uint8Array<ArrayBuffer>,
    rawSize: number,
  ): Buffer<ArrayBuffer> {
    const out = Buffer.allocUnsafe(WS_OUTPUT_CTX_HEADER_BYTES + compressed.length);
    out[0] = WS_OUTPUT_BROTLI_CTX;
    out.writeUInt32LE(rawSize, 1);
    out.set(compressed, WS_OUTPUT_CTX_HEADER_BYTES);
    return out;
  }

  async sendOutputFrame(
    ws: ClientSocket,
    bytes: Uint8Array<ArrayBuffer>,
    client: ManagedClient,
  ): Promise<void> {
    const mode = client.compressMode;
    if (mode === null) {
      // Framing-enabled clients always read a type byte, so raw output carries a
      // 0x00 header. Legacy clients keep the untyped stream.
      this.sendOutputBytes(
        ws,
        client.framingEnabled ? this.frameWithHeader(WS_OUTPUT_RAW, bytes) : bytes,
      );
      return;
    }
    if (mode === "br-ctx") {
      const encoder = client.brotliEncoder;
      if (!encoder) return;
      try {
        if (bytes.length < WS_OUTPUT_COMPRESS_THRESHOLD_BYTES) {
          await encoder.enqueue(
            () => this.sendOutputBytes(ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes)),
            bytes.byteLength,
          );
        } else {
          await encoder.flush(bytes, (compressed) =>
            this.sendOutputBytes(ws, this.frameWithCtxHeader(compressed, bytes.length)),
          );
        }
      } catch {
        return;
      }
      return;
    }
    if (bytes.length < WS_OUTPUT_COMPRESS_THRESHOLD_BYTES) {
      this.sendOutputBytes(ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
      return;
    }
    const compressed = this.compressPayload(bytes, mode);
    this.sendOutputBytes(
      ws,
      this.frameWithHeader(mode === "br" ? WS_OUTPUT_BROTLI : WS_OUTPUT_GZIP, compressed),
    );
  }

  broadcastPixelFrame(
    managed: ManagedSession,
    width: number,
    height: number,
    rgba: Uint8Array,
  ): void {
    // Frames are only deliverable over the always-on binary framing channel the
    // client negotiated ({ready} binaryFraming + the {binary-framing} confirm).
    // Pending attach and legacy clients keep their legacy byte stream; a frame
    // for them lands on the next relay after they promote.
    const frame = Buffer.allocUnsafe(WS_OUTPUT_FRAME_HEADER_BYTES + rgba.length);
    frame[0] = WS_OUTPUT_PIXEL_FRAME;
    frame.writeUInt32LE(width, 1);
    frame.writeUInt32LE(height, 5);
    frame.set(rgba, WS_OUTPUT_FRAME_HEADER_BYTES);
    for (const client of managed.clients) {
      if (client.pending || !client.framingEnabled) continue;
      this.sendOutputBytes(client.ws, frame);
    }
  }

  broadcastBytes(managed: ManagedSession, bytes: Uint8Array<ArrayBuffer>): void {
    if (bytes.length === 0) return;
    const compressible = bytes.length >= WS_OUTPUT_COMPRESS_THRESHOLD_BYTES;
    let brotli: Buffer<ArrayBuffer> | null = null;
    let gzip: Buffer<ArrayBuffer> | null = null;
    for (const client of managed.clients) {
      if (client.pending) {
        if (client.pendingOverflowed) continue;
        if (client.pendingBytesLength + bytes.byteLength > WS_PENDING_CLIENT_MAX_BYTES) {
          this.overflowPendingClient(client);
          continue;
        }
        client.pendingQueue.push({ bytes, kind: "output" });
        client.pendingBytesLength += bytes.byteLength;
        continue;
      }
      const mode = client.compressMode;
      if (mode === null) {
        this.sendOutputBytes(
          client.ws,
          client.framingEnabled ? this.frameWithHeader(WS_OUTPUT_RAW, bytes) : bytes,
        );
        continue;
      }
      if (mode === "br-ctx") {
        // Context compression is asynchronous. sendOutputFrame also queues raw
        // tail frames so neither they nor an atomic boundary can overtake it.
        void this.sendOutputFrame(client.ws, bytes, client);
        continue;
      }
      if (!compressible) {
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
        continue;
      }
      if (mode === "br") {
        if (brotli === null) brotli = this.compressPayload(bytes, "br");
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_BROTLI, brotli));
      } else {
        if (gzip === null) gzip = this.compressPayload(bytes, "gzip");
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_GZIP, gzip));
      }
    }
  }

  private reservePendingControlMessage(client: ManagedClient): boolean {
    if (client.pendingOverflowed) return false;
    if (client.pendingControlMessageCount >= WS_PENDING_CLIENT_MAX_CONTROL_MESSAGES) {
      this.overflowPendingClient(client);
      return false;
    }
    client.pendingControlMessageCount += 1;
    return true;
  }

  sendToClient(client: ManagedClient, payload: ServerToClientMessage): void {
    if (client.pending) {
      if (!this.reservePendingControlMessage(client)) return;
      client.pendingQueue.push({ kind: "control", payload });
      return;
    }
    this.sendControl(client.ws, payload);
  }

  private overflowPendingClient(client: ManagedClient): void {
    client.pendingOverflowed = true;
    client.pendingQueue = [];
    client.pendingBytesLength = 0;
    client.pendingControlMessageCount = 0;
    try {
      client.ws.close(WS_CLOSE_BACKPRESSURE, "pending client backpressure");
    } catch {
      return;
    }
  }

  async sendAtomicOutputFrameBoundary(
    client: ManagedClient,
    boundary: "output-frame-start" | "output-frame-end",
  ): Promise<void> {
    const payload: ServerToClientMessage = { type: boundary };
    const encoder = client.compressMode === "br-ctx" ? client.brotliEncoder : null;
    if (encoder) {
      try {
        await encoder.enqueue(() => this.sendControl(client.ws, payload));
      } catch {
        return;
      }
      return;
    }
    this.sendControl(client.ws, payload);
  }

  broadcastAtomicOutputFrameBoundary(
    managed: ManagedSession,
    boundary: "output-frame-start" | "output-frame-end",
  ): void {
    for (const client of managed.clients) {
      if (client.pending) {
        if (!this.reservePendingControlMessage(client)) continue;
        client.pendingQueue.push({ kind: boundary });
      } else {
        void this.sendAtomicOutputFrameBoundary(client, boundary);
      }
    }
  }

  broadcast(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const client of managed.clients) this.sendToClient(client, payload);
  }
}
