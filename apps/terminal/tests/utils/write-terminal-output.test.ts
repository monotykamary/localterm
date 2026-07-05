import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
} from "../../src/lib/constants";
import { OutputBatcher } from "../../src/utils/write-terminal-output";

// Minimal xterm stub: record every write arg. The batcher only touches
// terminal.write, so we don't need the real Terminal (which would drag in the
// DOM and the full parser). The cast is required because OutputBatcher.attach
// is typed against the full XtermTerminal surface.
const createFakeTerminal = (writes: Uint8Array[]): XtermTerminal =>
  ({
    write: (data: Uint8Array, callback?: () => void) => {
      writes.push(data);
      callback?.();
    },
  }) as unknown as XtermTerminal;

// A write above the batcher's initial buffer capacity (8KB) so a "large" push
// exercises the growth path; the exact size is otherwise arbitrary (the server
// caps a real message at OUTPUT_BATCH_FLUSH_BYTES, well under xterm's 12ms
// parse-yield budget).
const LARGE_BYTES = OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES + 4096;

// Recording rAF: registers the callback but never fires it, so onKeepWarm only
// runs when the test calls pendingCb explicitly. This sidesteps the
// synchronous-stub infinite-recurse that the isDispatching guard exists for,
// and lets the test observe whether onKeepWarm re-armed by checking rafCount.
let rafCount = 0;
let pendingCb: ((highResTimestamp: number) => void) | null = null;

beforeEach(() => {
  rafCount = 0;
  pendingCb = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCount += 1;
    pendingCb = cb;
    return rafCount;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OutputBatcher staging buffer growth", () => {
  it("grows past OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES without truncating tail bytes", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    const oversized = OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES + 2048;
    const bytes = new Uint8Array(oversized);
    for (let index = 0; index < oversized; index += 1) bytes[index] = index & 0xff;

    batcher.pushBytes(bytes);
    // Staged, not yet flushed.
    expect(writes).toHaveLength(0);
    batcher.detach();

    expect(writes).toHaveLength(1);
    expect(writes[0].byteLength).toBe(oversized);
    expect(writes[0]).toEqual(bytes);
  });
});

describe("OutputBatcher stage-until-flush (the frame-end marker)", () => {
  it("stages output on pushBytes without flushing (the server marks the boundary)", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    // No flush on arrival — the server's output-flush marker (a separate WS
    // message) commits the staged frame as one render. So nothing writes yet.
    expect(writes).toHaveLength(0);
    // A keep-warm rAF is armed (compositor warmth) so the frame loop stays warm
    // while the frame stages.
    expect(rafCount).toBe(1);
    batcher.detach();
  });

  it("flushStaged commits the staged frame as one terminal.write", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    expect(writes).toHaveLength(0);
    batcher.flushStaged();

    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    batcher.detach();
  });

  it("coalesces a split frame: stages each message, renders all at flushStaged", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    // A frame the server split across messages at the 64KB cap: the client
    // stages each split and renders the whole frame in one paint when the end
    // marker lands — no progressive crawl over a bandwidth-limited link.
    batcher.pushBytes(new Uint8Array(LARGE_BYTES).fill(1));
    batcher.pushBytes(new Uint8Array(LARGE_BYTES).fill(2));
    batcher.pushBytes(new Uint8Array([7, 8, 9]));
    expect(writes).toHaveLength(0);

    batcher.flushStaged();
    expect(writes).toHaveLength(1);
    expect(writes[0].byteLength).toBe(LARGE_BYTES * 2 + 3);
    // The staged splits concatenate in arrival order.
    expect(writes[0][0]).toBe(1);
    expect(writes[0][LARGE_BYTES]).toBe(2);
    expect(writes[0][LARGE_BYTES * 2]).toBe(7);
    batcher.detach();
  });

  it("flushStaged on an empty buffer is a no-op (no zero-length write)", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.flushStaged();
    expect(writes).toHaveLength(0);
    batcher.detach();
  });

  it("flushStaged resets staging so the next frame stages fresh", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([1, 2, 3]));
    batcher.flushStaged();
    expect(writes).toHaveLength(1);

    batcher.pushBytes(new Uint8Array([4, 5, 6]));
    expect(writes).toHaveLength(1);
    batcher.flushStaged();
    expect(writes).toHaveLength(2);
    expect(Array.from(writes[1])).toEqual([4, 5, 6]);
    batcher.detach();
  });
});

describe("OutputBatcher keep-warm rAF cadence", () => {
  it("re-arms the rAF within OUTPUT_KEEP_WARM_MS of the last output", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    expect(rafCount).toBe(1);
    const firstFrame = pendingCb;
    expect(firstFrame).toBeTruthy();

    firstFrame!(performance.now());

    expect(writes).toHaveLength(0); // keep-warm carries no flush work
    expect(rafCount).toBe(2);
    batcher.detach();
  });

  it("lets the rAF lapse once output goes idle past OUTPUT_KEEP_WARM_MS", async () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([65]));
    expect(rafCount).toBe(1);
    const firstFrame = pendingCb;
    expect(firstFrame).toBeTruthy();

    // Let real wall-clock time elapse past the keep-warm window with no fresh
    // output, then fire the queued frame: onKeepWarm must NOT re-arm.
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_KEEP_WARM_MS + 50));
    firstFrame!(performance.now());

    expect(rafCount).toBe(1);
  });
});

describe("OutputBatcher background-tab stage/flush", () => {
  it("stages while hidden with no rAF, and flushStaged writes synchronously", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    vi.stubGlobal("document", { hidden: true });

    try {
      batcher.pushBytes(new Uint8Array([65, 66, 67]));
      // A hidden document must not arm a (paused) rAF: it stages without one.
      expect(rafCount).toBe(0);
      expect(writes).toHaveLength(0);

      batcher.flushStaged();
      expect(writes).toHaveLength(1);
      expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    } finally {
      vi.unstubAllGlobals();
    }
    batcher.detach();
  });
});
