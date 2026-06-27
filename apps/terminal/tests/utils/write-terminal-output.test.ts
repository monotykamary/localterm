import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
  OUTPUT_SYNC_FLUSH_MAX_BYTES,
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

// Recording rAF: registers the callback but never fires it, so onFrame only
// runs when the test calls pendingCb explicitly. This sidesteps the
// synchronous-stub infinite-recurse that the isDispatching guard exists for,
// and lets the test observe whether onFrame re-armed by checking rafCount.
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
    batcher.detach();

    expect(writes).toHaveLength(1);
    expect(writes[0].byteLength).toBe(oversized);
    expect(writes[0]).toEqual(bytes);
  });

  it("coalesces large pushes into a single flush via detach", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    // Large frames (above the sync-flush threshold) defer to rAF, so multiple
    // pushes coalesce in the staging buffer until detach flushes them as one.
    const large = OUTPUT_SYNC_FLUSH_MAX_BYTES + 1;
    batcher.pushBytes(new Uint8Array(large).fill(1));
    batcher.pushBytes(new Uint8Array(large).fill(2));
    batcher.pushBytes(new Uint8Array(large).fill(3));

    batcher.detach();

    expect(writes).toHaveLength(1);
    expect(writes[0].byteLength).toBe(large * 3);
  });
});

describe("OutputBatcher visible sync flush", () => {
  it("flushes small output synchronously so xterm answers queries without rAF deferral", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    // A small frame (a terminal query plus a prompt redraw) flushes immediately
    // — no rAF deferral — so xterm parses and answers it in the same task and
    // the probing program reads the response before its short read timeout,
    // instead of the response leaking into the shell as typed text.
    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    // A keep-warm rAF is armed (not a deferred flush) so the compositor stays
    // warm; its onFrame no-ops the flush on an empty buffer.
    expect(rafCount).toBe(1);
    expect(pendingCb).not.toBeNull();
    batcher.detach();
  });

  it("flushes each small push separately (no coalescing) for low latency", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([1, 2, 3]));
    batcher.pushBytes(new Uint8Array([4, 5, 6, 7]));
    batcher.pushBytes(new Uint8Array([8]));

    // Small frames flush on each push (low latency beats coalescing for
    // interactive output), so three writes land.
    expect(writes).toHaveLength(3);
    expect(Array.from(writes[0])).toEqual([1, 2, 3]);
    expect(Array.from(writes[1])).toEqual([4, 5, 6, 7]);
    expect(Array.from(writes[2])).toEqual([8]);
    batcher.detach();
  });

  it("coalesces large output via rAF for throughput", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    const large = OUTPUT_SYNC_FLUSH_MAX_BYTES + 1;
    batcher.pushBytes(new Uint8Array(large).fill(1));
    batcher.pushBytes(new Uint8Array(large).fill(2));
    // Large frames defer to a single armed rAF, coalescing in the buffer.
    expect(rafCount).toBe(1);
    expect(writes).toHaveLength(0);

    pendingCb!(performance.now());
    expect(writes).toHaveLength(1);
    expect(writes[0].byteLength).toBe(large * 2);
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

    expect(writes).toHaveLength(1);
    expect(rafCount).toBe(2);
    expect(pendingCb).not.toBeNull();
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
    // output, then fire the queued frame: onFrame must flush but NOT re-arm.
    await new Promise((resolve) => setTimeout(resolve, OUTPUT_KEEP_WARM_MS + 50));
    firstFrame!(performance.now());

    expect(writes).toHaveLength(1);
    expect(rafCount).toBe(1);
  });
});

describe("OutputBatcher background-tab flush", () => {
  it("flushes synchronously (no rAF) while the document is hidden", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    vi.stubGlobal("document", { hidden: true });

    try {
      batcher.pushBytes(new Uint8Array([65, 66, 67]));
      // A hidden document must not defer the flush to a paused/throttled rAF:
      // it writes immediately so xterm can answer a query before the probing
      // program's read times out.
      expect(rafCount).toBe(0);
      expect(writes).toHaveLength(1);
      expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    } finally {
      vi.unstubAllGlobals();
    }
    batcher.detach();
  });

  it("coalesces a burst while hidden into a single synchronous write", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    vi.stubGlobal("document", { hidden: true });

    try {
      batcher.pushBytes(new Uint8Array([65]));
      batcher.pushBytes(new Uint8Array([66, 67]));
      // Each hidden push flushes, so two writes land — but no rAF is ever armed.
      expect(rafCount).toBe(0);
      expect(writes).toHaveLength(2);
      expect(Array.from(writes[0])).toEqual([65]);
      expect(Array.from(writes[1])).toEqual([66, 67]);
    } finally {
      vi.unstubAllGlobals();
    }
    batcher.detach();
  });
});
