import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  INTERACTIVE_OUTPUT_RENDER_MAX_BYTES,
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
} from "../../src/lib/constants";
import { OutputBatcher } from "../../src/utils/write-terminal-output";

interface FakeTerminalOptions {
  pendingRenderFrameId?: number;
  onRenderFlush?: () => void;
}

// Minimal xterm stub: record every write and expose the render debouncer used
// by the interactive fast path. The cast is required because
// OutputBatcher.attach is typed against the full XtermTerminal surface.
const createFakeTerminal = (
  writes: Uint8Array[],
  options: FakeTerminalOptions = {},
): XtermTerminal =>
  ({
    _core: {
      _renderService: {
        _renderDebouncer: {
          _animationFrame: options.pendingRenderFrameId,
          _innerRefresh: options.onRenderFlush,
        },
      },
    },
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
const PENDING_RENDER_FRAME_ID = 73;

interface RenderFlushHarness {
  batcher: OutputBatcher;
  writes: Uint8Array[];
  readRenderFlushCount: () => number;
}

const createRenderFlushHarness = (): RenderFlushHarness => {
  const writes: Uint8Array[] = [];
  let renderFlushCount = 0;
  const batcher = new OutputBatcher();
  batcher.attach(
    createFakeTerminal(writes, {
      pendingRenderFrameId: PENDING_RENDER_FRAME_ID,
      onRenderFlush: () => {
        renderFlushCount += 1;
      },
    }),
  );
  return {
    batcher,
    writes,
    readRenderFlushCount: () => renderFlushCount,
  };
};

// Recording rAF: registers the callback but never fires it, so onKeepWarm only
// runs when the test calls pendingCb explicitly. This sidesteps the
// synchronous-stub infinite-recurse that the isDispatching guard exists for,
// and lets the test observe whether onKeepWarm re-armed by checking rafCount.
let rafCount = 0;
let pendingCb: ((highResTimestamp: number) => void) | null = null;
let canceledFrameIds: number[] = [];

beforeEach(() => {
  rafCount = 0;
  pendingCb = null;
  canceledFrameIds = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafCount += 1;
    pendingCb = cb;
    return rafCount;
  });
  vi.stubGlobal("cancelAnimationFrame", (frameId: number) => canceledFrameIds.push(frameId));
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
});

describe("OutputBatcher raw in/out (flush on arrival)", () => {
  it("consumes the pending WebGL render for a small response after user input", () => {
    const { batcher, writes, readRenderFlushCount } = createRenderFlushHarness();
    batcher.setInteractiveRenderingEnabled(true);

    batcher.noteUserInput();
    batcher.pushBytes(new Uint8Array([65, 66, 67]));

    expect(writes).toHaveLength(1);
    expect(readRenderFlushCount()).toBe(1);
    expect(canceledFrameIds).toContain(PENDING_RENDER_FRAME_ID);
    batcher.detach();
  });

  it("leaves input responses on the normal rAF when WebGL is unavailable", () => {
    const { batcher, writes, readRenderFlushCount } = createRenderFlushHarness();

    batcher.noteUserInput();
    batcher.pushBytes(new Uint8Array([65, 66, 67]));

    expect(writes).toHaveLength(1);
    expect(readRenderFlushCount()).toBe(0);
    expect(canceledFrameIds).not.toContain(PENDING_RENDER_FRAME_ID);
    batcher.detach();
  });

  it("leaves autonomous output on xterm's normal render rAF", () => {
    const { batcher, writes, readRenderFlushCount } = createRenderFlushHarness();
    batcher.setInteractiveRenderingEnabled(true);

    batcher.pushBytes(new Uint8Array([65, 66, 67]));

    expect(writes).toHaveLength(1);
    expect(readRenderFlushCount()).toBe(0);
    expect(canceledFrameIds).not.toContain(PENDING_RENDER_FRAME_ID);
    batcher.detach();
  });

  it("does not synchronously render a throughput-sized response after input", () => {
    const { batcher, writes, readRenderFlushCount } = createRenderFlushHarness();
    batcher.setInteractiveRenderingEnabled(true);

    batcher.noteUserInput();
    batcher.pushBytes(new Uint8Array(INTERACTIVE_OUTPUT_RENDER_MAX_BYTES + 1));
    batcher.pushBytes(new Uint8Array([65]));

    expect(writes).toHaveLength(2);
    expect(readRenderFlushCount()).toBe(0);
    expect(canceledFrameIds).not.toContain(PENDING_RENDER_FRAME_ID);
    batcher.detach();
  });

  it("flushes small output synchronously so xterm answers queries in the same task", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    // A small frame (a terminal query plus a prompt redraw) flushes
    // immediately — no deferral — so xterm parses and answers it in the same
    // task and the probing program reads the response before its short read
    // timeout, instead of the response leaking into the shell as typed text.
    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    // A keep-warm rAF is armed (not a deferred flush) so the compositor stays
    // warm; its onKeepWarm no-ops on an empty buffer.
    expect(rafCount).toBe(1);
    expect(pendingCb).not.toBeNull();
    batcher.detach();
  });

  it("flushes each push separately (no coalescing) for lowest latency", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array([1, 2, 3]));
    batcher.pushBytes(new Uint8Array([4, 5, 6, 7]));
    batcher.pushBytes(new Uint8Array([8]));

    // The server coalesces one logical frame per WebSocket message, so the
    // client does not coalesce — each push flushes on arrival (lowest latency
    // beats coalescing for interactive/animated output), so three writes land.
    expect(writes).toHaveLength(3);
    expect(Array.from(writes[0])).toEqual([1, 2, 3]);
    expect(Array.from(writes[1])).toEqual([4, 5, 6, 7]);
    expect(Array.from(writes[2])).toEqual([8]);
    batcher.detach();
  });

  it("flushes large output immediately, not deferred to a timer or rAF", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    batcher.pushBytes(new Uint8Array(LARGE_BYTES).fill(1));
    batcher.pushBytes(new Uint8Array(LARGE_BYTES).fill(2));

    // Large frames flush on arrival (no rAF/idle-debounce deferral), so both
    // writes land immediately. Only the no-op keep-warm rAF is armed.
    expect(writes).toHaveLength(2);
    expect(writes[0].byteLength).toBe(LARGE_BYTES);
    expect(writes[1].byteLength).toBe(LARGE_BYTES);
    expect(rafCount).toBe(1);
    batcher.detach();
  });

  it("flushes a small interactive write immediately even during a stream", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    // A high-throughput stream message flushes on arrival, then a keystroke
    // echo / terminal query that lands right after it flushes in its own
    // task — xterm answers the query before the probing program's read times
    // out, and the echo paints without waiting on anything.
    batcher.pushBytes(new Uint8Array(LARGE_BYTES).fill(1));
    expect(writes).toHaveLength(1);

    batcher.pushBytes(new Uint8Array([65, 66, 67]));
    expect(writes).toHaveLength(2);
    expect(writes[1].byteLength).toBe(3);
    expect(Array.from(writes[1])).toEqual([65, 66, 67]);
    batcher.detach();
  });
});

describe("OutputBatcher keep-warm rAF cadence", () => {
  it("pauses keep-warm through an immediate response and re-arms for autonomous output", () => {
    const { batcher, writes, readRenderFlushCount } = createRenderFlushHarness();
    batcher.setInteractiveRenderingEnabled(true);

    batcher.pushBytes(new Uint8Array([65]));
    const initialKeepWarmFrameId = rafCount;

    batcher.noteUserInput();

    expect(canceledFrameIds).toContain(initialKeepWarmFrameId);
    const frameCountBeforeResponse = rafCount;

    batcher.pushBytes(new Uint8Array([66]));

    expect(writes).toHaveLength(2);
    expect(readRenderFlushCount()).toBe(1);
    expect(rafCount).toBe(frameCountBeforeResponse);

    batcher.pushBytes(new Uint8Array([67]));

    expect(rafCount).toBeGreaterThan(frameCountBeforeResponse);
    batcher.detach();
  });

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
    // output, then fire the queued frame: onKeepWarm must NOT re-arm.
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
      // A hidden document must not arm a (paused) rAF: it writes immediately so
      // xterm can answer a query before the probing program's read times out.
      expect(rafCount).toBe(0);
      expect(writes).toHaveLength(1);
      expect(Array.from(writes[0])).toEqual([65, 66, 67]);
    } finally {
      vi.unstubAllGlobals();
    }
    batcher.detach();
  });

  it("flushes each hidden push separately with no rAF", () => {
    const writes: Uint8Array[] = [];
    const batcher = new OutputBatcher();
    batcher.attach(createFakeTerminal(writes));

    vi.stubGlobal("document", { hidden: true });

    try {
      batcher.pushBytes(new Uint8Array([65]));
      batcher.pushBytes(new Uint8Array([66, 67]));
      // Each hidden push flushes on arrival — two writes — and no rAF is armed.
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
