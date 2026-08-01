import { describe, expect, it } from "vite-plus/test";
import {
  WS_OUTPUT_BROTLI_QUALITY,
  WS_OUTPUT_FRAME_HEADER_BYTES,
  WS_OUTPUT_PIXEL_FRAME,
  WS_OUTPUT_RAW,
  WS_READY_STATE_OPEN,
} from "../src/constants.js";
import type { ManagedClient, ManagedSession } from "../src/session-manager.js";
import { makeBrotliEncoder, SessionOutputTransport } from "../src/session-output-transport.js";
import type { ClientSocket } from "../src/utils/ws-socket.js";

describe("makeBrotliEncoder", () => {
  it("tracks queued raw bytes until serialized flushes settle", async () => {
    const encoder = makeBrotliEncoder(WS_OUTPUT_BROTLI_QUALITY);
    const firstBytes = new Uint8Array(1_024);
    const secondBytes = new Uint8Array(2_048);

    const first = encoder.flush(firstBytes);
    const second = encoder.flush(secondBytes);
    expect(encoder.queuedBytes()).toBe(firstBytes.byteLength + secondBytes.byteLength);

    await Promise.all([first, second]);
    expect(encoder.queuedBytes()).toBe(0);
    encoder.release();
  });

  it("rejects queued work and releases its byte accounting on teardown", async () => {
    const encoder = makeBrotliEncoder(WS_OUTPUT_BROTLI_QUALITY);
    const bytes = new Uint8Array(1_024);
    const pending = encoder.flush(bytes);

    encoder.release();

    await expect(pending).rejects.toThrow("released");
    expect(encoder.queuedBytes()).toBe(0);
    encoder.release();
  });
});

describe("pixel frames and always-on binary framing", () => {
  const fakeClient = (
    overrides: Partial<ManagedClient>,
  ): { client: ManagedClient; sent: Uint8Array[] } => {
    const sent: Uint8Array[] = [];
    const ws = {
      readyState: WS_READY_STATE_OPEN,
      send: (raw: string | ArrayBuffer | Uint8Array) => {
        if (typeof raw === "string") return;
        sent.push(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
      },
      close: () => undefined,
    };
    const client = {
      ws,
      pending: false,
      pendingBytes: [],
      pendingBytesLength: 0,
      pendingControl: [],
      pendingOverflowed: false,
      compressMode: null,
      brotliEncoder: null,
      framingEnabled: false,
      ...overrides,
    } as unknown as ManagedClient;
    return { client, sent };
  };

  it("sends pixel frames only to framing-enabled live clients", () => {
    const transport = new SessionOutputTransport(() => undefined);
    const framed = fakeClient({ framingEnabled: true });
    const legacy = fakeClient({ framingEnabled: false });
    const managed = {
      id: "test",
      clients: new Set([framed.client, legacy.client]),
    } as unknown as ManagedSession;
    transport.broadcastPixelFrame(managed, 2, 1, new Uint8Array(8));
    expect(legacy.sent.length).toBe(0);
    expect(framed.sent.length).toBe(1);
    const frame = framed.sent[0];
    expect(frame[0]).toBe(WS_OUTPUT_PIXEL_FRAME);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    expect(view.getUint32(1, true)).toBe(2);
    expect(view.getUint32(5, true)).toBe(1);
    expect(frame.byteLength).toBe(WS_OUTPUT_FRAME_HEADER_BYTES + 8);
  });

  it("skips pixel frames for pending clients", () => {
    const transport = new SessionOutputTransport(() => undefined);
    const pending = fakeClient({ framingEnabled: true, pending: true });
    const managed = {
      id: "test",
      clients: new Set([pending.client]),
    } as unknown as ManagedSession;
    transport.broadcastPixelFrame(managed, 1, 1, new Uint8Array(4));
    expect(pending.sent.length).toBe(0);
  });

  it("adds a raw header byte for framing-enabled raw-mode clients", async () => {
    const transport = new SessionOutputTransport(() => undefined);
    const framed = fakeClient({ framingEnabled: true, compressMode: null });
    await transport.sendOutputFrame(
      (framed.client as unknown as { ws: ClientSocket }).ws,
      new Uint8Array([104, 105]),
      framed.client,
    );
    expect(framed.sent.length).toBe(1);
    expect(Array.from(framed.sent[0])).toEqual([WS_OUTPUT_RAW, 104, 105]);
  });

  it("keeps untyped raw output for legacy raw-mode clients", async () => {
    const transport = new SessionOutputTransport(() => undefined);
    const legacy = fakeClient({ framingEnabled: false, compressMode: null });
    await transport.sendOutputFrame(
      (legacy.client as unknown as { ws: ClientSocket }).ws,
      new Uint8Array([104, 105]),
      legacy.client,
    );
    expect(legacy.sent.length).toBe(1);
    expect(Array.from(legacy.sent[0])).toEqual([104, 105]);
  });
});
