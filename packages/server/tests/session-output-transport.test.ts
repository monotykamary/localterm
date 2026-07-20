import { describe, expect, it } from "vite-plus/test";
import { WS_OUTPUT_BROTLI_QUALITY } from "../src/constants.js";
import { makeBrotliEncoder } from "../src/session-output-transport.js";

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
  });
});
