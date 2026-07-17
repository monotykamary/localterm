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
  WS_OUTPUT_GZIP,
  WS_OUTPUT_GZIP_LEVEL,
  WS_OUTPUT_RAW,
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
  flush: (bytes: Uint8Array<ArrayBuffer>) => Promise<Buffer<ArrayBuffer>>;
  release: () => void;
}
export const makeBrotliEncoder = (level: number): BrotliEncoder => {
  const enc = zlib.createBrotliCompress({
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
  });
  let buf = Buffer.alloc(0);
  enc.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
  });
  let chain: Promise<Buffer<ArrayBuffer>> = Promise.resolve(Buffer.alloc(0));
  const flush = (bytes: Uint8Array<ArrayBuffer>): Promise<Buffer<ArrayBuffer>> => {
    chain = chain.then(
      () =>
        new Promise<Buffer<ArrayBuffer>>((resolve) => {
          const before = buf.length;
          enc.write(bytes);
          enc.flush(zlib.constants.BROTLI_OPERATION_FLUSH, () => {
            setImmediate(() => {
              const out = buf.subarray(before, buf.length);
              buf = buf.subarray(buf.length);
              resolve(out);
            });
          });
        }),
    );
    return chain;
  };
  const release = () => {
    try {
      enc.destroy();
    } catch {
      /* already closed */
    }
  };
  return { flush, release };
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
      this.sendOutputBytes(ws, bytes);
      return;
    }
    if (bytes.length < WS_OUTPUT_COMPRESS_THRESHOLD_BYTES) {
      this.sendOutputBytes(ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
      return;
    }
    if (mode === "br-ctx") {
      const compressed = await client.brotliEncoder!.flush(bytes);
      this.sendOutputBytes(ws, this.frameWithCtxHeader(compressed, bytes.length));
      return;
    }
    const compressed = this.compressPayload(bytes, mode);
    this.sendOutputBytes(
      ws,
      this.frameWithHeader(mode === "br" ? WS_OUTPUT_BROTLI : WS_OUTPUT_GZIP, compressed),
    );
  }

  broadcastBytes(managed: ManagedSession, bytes: Uint8Array<ArrayBuffer>): void {
    if (bytes.length === 0) return;
    const compressible = bytes.length >= WS_OUTPUT_COMPRESS_THRESHOLD_BYTES;
    let brotli: Buffer<ArrayBuffer> | null = null;
    let gzip: Buffer<ArrayBuffer> | null = null;
    for (const client of managed.clients) {
      if (client.pending) {
        client.pendingBytes.push(bytes);
        continue;
      }
      const mode = client.compressMode;
      if (mode === null) {
        this.sendOutputBytes(client.ws, bytes);
        continue;
      }
      if (!compressible) {
        this.sendOutputBytes(client.ws, this.frameWithHeader(WS_OUTPUT_RAW, bytes));
        continue;
      }
      if (mode === "br-ctx") {
        // Per-client persistent stream: the flush is async (chained per encoder
        // in PTY order), so fire-and-forget here — the chain preserves order
        // across this client's frames and sendOutputBytes checks
        // readyState/backpressure at send time.
        void client
          .brotliEncoder!.flush(bytes)
          .then((compressed) =>
            this.sendOutputBytes(client.ws, this.frameWithCtxHeader(compressed, bytes.length)),
          );
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

  sendToClient(client: ManagedClient, payload: ServerToClientMessage): void {
    if (client.pending) {
      client.pendingControl.push(payload);
      return;
    }
    this.sendControl(client.ws, payload);
  }

  broadcast(managed: ManagedSession, payload: ServerToClientMessage): void {
    for (const client of managed.clients) this.sendToClient(client, payload);
  }
}
