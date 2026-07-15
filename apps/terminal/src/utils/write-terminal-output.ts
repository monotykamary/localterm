import {
  INTERACTIVE_OUTPUT_RENDER_MAX_BYTES,
  INTERACTIVE_OUTPUT_RENDER_WINDOW_MS,
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
  SYNCHRONIZED_OUTPUT_END_SEQUENCE,
} from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

interface XtermRenderDebouncer {
  _animationFrame?: number;
  _innerRefresh?: () => void;
}

interface XtermRenderService {
  _renderDebouncer?: XtermRenderDebouncer;
}

interface XtermCore {
  _renderService?: XtermRenderService;
}

interface XtermTerminalWithCore extends XtermTerminal {
  _core?: XtermCore;
}

interface PendingTerminalWrite {
  bytes: Uint8Array;
  endsSynchronizedOutput: boolean;
}

const performanceNow = () => performance.now();

const isDocumentHidden = (): boolean => typeof document !== "undefined" && document.hidden;

// xterm exposes synchronous redraw internally but not through its public API.
// Consume the render range its parser already queued instead of requesting a
// second full render; canceling that range's rAF prevents duplicate GPU work.
// Missing internals degrade to xterm's normal scheduled render.
const flushPendingInteractiveRender = (terminal: XtermTerminal): void => {
  const renderDebouncer = (terminal as XtermTerminalWithCore)._core?._renderService
    ?._renderDebouncer;
  if (!renderDebouncer?._innerRefresh) return;
  if (renderDebouncer._animationFrame !== undefined) {
    cancelAnimationFrame(renderDebouncer._animationFrame);
  }
  renderDebouncer._innerRefresh();
};

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private buffer = new Uint8Array(OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES);
  private byteLength = 0;
  private pendingWrites: PendingTerminalWrite[] = [];
  private synchronizedOutputEndMatchLength = 0;
  private awaitingSynchronizedFrameRender = false;
  private synchronizedFrameGeneration = 0;
  private synchronizedFrameReleaseId: number | null = null;
  private synchronizedFramePacingBypassAtMs = Number.NEGATIVE_INFINITY;
  // No-op vsync commit that keeps Chrome's compositor frame loop warm across
  // the gaps between animation frames. Carries no parse work — the flush is
  // synchronous in pushBytes — so it can't starve xterm's render rAF.
  private keepWarmFrameId: number | null = null;
  private lastOutputAtMs = 0;
  private lastUserInputAtMs = Number.NEGATIVE_INFINITY;
  private interactiveRenderingEnabled = false;
  private afterFlush: (() => void) | null = null;
  // Re-entrancy guard for test rAF stubs that fire the callback synchronously
  // inside requestAnimationFrame, which would infinite-recurse via the
  // keep-warm re-arm. Checked at entry: a synchronous inner fire skips; the
  // next vsync (or time advance in tests) picks up the re-arm the outer set.
  private isDispatching = false;

  attach = (terminal: XtermTerminal) => {
    this.terminal = terminal;
    this.pendingWrites = [];
    this.synchronizedOutputEndMatchLength = 0;
    this.awaitingSynchronizedFrameRender = false;
    this.synchronizedFrameGeneration += 1;
    this.synchronizedFrameReleaseId = null;
    this.synchronizedFramePacingBypassAtMs = Number.NEGATIVE_INFINITY;
    this.lastUserInputAtMs = Number.NEGATIVE_INFINITY;
    this.interactiveRenderingEnabled = false;
  };

  setInteractiveRenderingEnabled = (enabled: boolean) => {
    this.interactiveRenderingEnabled = enabled;
  };

  noteUserInput = () => {
    const inputAtMs = performanceNow();
    this.lastUserInputAtMs = inputAtMs;
    this.synchronizedFramePacingBypassAtMs = inputAtMs;
    // Chromium can defer inbound WebSocket delivery to the next vsync while
    // the no-op frame loop is armed. Autonomous output re-arms it later.
    this.cancelKeepWarm();
    this.cancelSynchronizedFrameWait();
  };

  setAfterFlush = (callback: (() => void) | null) => {
    this.afterFlush = callback;
  };

  detach = () => {
    this.cancelKeepWarm();
    this.cancelSynchronizedFrameWait();
    this.lastUserInputAtMs = Number.NEGATIVE_INFINITY;
    this.interactiveRenderingEnabled = false;
    this.flushPending(true);
    this.pendingWrites = [];
    this.synchronizedOutputEndMatchLength = 0;
    this.synchronizedFramePacingBypassAtMs = Number.NEGATIVE_INFINITY;
    this.terminal = null;
    this.afterFlush = null;
  };

  // Output frames arrive as raw UTF-8 bytes (a binary WebSocket frame), so the
  // staging path is a straight memcpy into the backing buffer — no string
  // roundtrip, no TextEncoder. xterm parses UTF-8 natively.
  pushBytes = (bytes: Uint8Array) => {
    this.enqueueBytes(bytes);
    this.lastOutputAtMs = performanceNow();
    // Raw in/out: flush on arrival. The server coalesces ordinary TUI bursts
    // and caps each message at OUTPUT_BATCH_FLUSH_BYTES (under xterm's 12ms
    // parse-yield budget). Larger DEC 2026 frames span multiple messages; the
    // completed-frame gate below preserves those message boundaries and only
    // holds the following frame until xterm presents the completed one. The
    // client does NOT coalesce — each message is one terminal.write in this WS
    // message task (a macrotask, not a requestAnimationFrame), so xterm's parse
    // never runs inside a vsync and can't starve the render rAF. xterm's own
    // render rAF is the single vsync gate for normal output. A bounded response
    // immediately following PTY input consumes that pending WebGL render in the
    // write callback, letting it make the current compositor frame without
    // changing the parse or batching path for autonomous output. Flushing on arrival
    // gives every other frame the earliest possible render rAF: no latency
    // window to shift a frame past a vsync boundary and skip it (the visible
    // jank on a 60fps TUI animation such as the opentui golden-star demo). A
    // backgrounded browser tab pauses rAF and throttles setTimeout to ~1Hz, but
    // flushing synchronously here lets xterm parse a ≤64KB write within its
    // 12ms budget in the same task — answering a terminal query before the
    // probing program's read times out (the response otherwise leaks into the
    // shell as typed text, e.g. `62;4;9;22c` on switching tabs back), and
    // never spilling to xterm's async drain (no partial paint). There is no
    // paint cost while hidden.
    const didRenderImmediately = this.flushPending();
    // The bounded WebGL fast path already draws in this task. Re-arming the
    // no-op frame loop here makes Chromium defer the next response to vsync.
    if (!isDocumentHidden() && !didRenderImmediately) this.armKeepWarm();
  };

  private ensureCapacity = (additionalBytes: number) => {
    if (this.buffer.byteLength - this.byteLength >= additionalBytes) return;
    const grown = new Uint8Array(
      Math.max(this.buffer.byteLength * 2, this.byteLength + additionalBytes),
    );
    grown.set(this.buffer.subarray(0, this.byteLength));
    this.buffer = grown;
  };

  private appendBytes = (bytes: Uint8Array) => {
    this.ensureCapacity(bytes.byteLength);
    this.buffer.set(bytes, this.byteLength);
    this.byteLength += bytes.byteLength;
  };

  private enqueueBytes = (bytes: Uint8Array) => {
    let segmentStart = 0;
    for (let byteIndex = 0; byteIndex < bytes.byteLength; byteIndex += 1) {
      const byte = bytes[byteIndex];
      const expectedByte = SYNCHRONIZED_OUTPUT_END_SEQUENCE.charCodeAt(
        this.synchronizedOutputEndMatchLength,
      );
      if (byte === expectedByte) {
        this.synchronizedOutputEndMatchLength += 1;
      } else {
        this.synchronizedOutputEndMatchLength =
          byte === SYNCHRONIZED_OUTPUT_END_SEQUENCE.charCodeAt(0) ? 1 : 0;
      }
      if (this.synchronizedOutputEndMatchLength !== SYNCHRONIZED_OUTPUT_END_SEQUENCE.length) {
        continue;
      }
      this.synchronizedOutputEndMatchLength = 0;
      this.enqueueWrite(bytes.subarray(segmentStart, byteIndex + 1), true);
      segmentStart = byteIndex + 1;
    }
    if (segmentStart < bytes.byteLength) {
      this.enqueueWrite(bytes.subarray(segmentStart), false);
    }
  };

  private enqueueWrite = (bytes: Uint8Array, endsSynchronizedOutput: boolean) => {
    if (bytes.byteLength === 0) return;
    this.appendBytes(bytes);
    this.pendingWrites.push({
      bytes: this.buffer.subarray(0, this.byteLength).slice(),
      endsSynchronizedOutput,
    });
    this.byteLength = 0;
  };

  // Re-arm a no-op vsync commit after a flush so a run of frames keeps the
  // compositor's frame loop warm (a hidden-tab hibernation here would stall
  // the next frame ~100ms). The armed rAF's onKeepWarm finds the buffer empty
  // (already flushed), no-ops, and re-arms within OUTPUT_KEEP_WARM_MS. No-op
  // when output has lapsed past the window.
  private armKeepWarm = () => {
    if (this.keepWarmFrameId !== null) return;
    if (performanceNow() - this.lastOutputAtMs >= OUTPUT_KEEP_WARM_MS) return;
    this.keepWarmFrameId = requestAnimationFrame(this.onKeepWarm);
  };

  private cancelKeepWarm = () => {
    if (this.keepWarmFrameId === null) return;
    cancelAnimationFrame(this.keepWarmFrameId);
    this.keepWarmFrameId = null;
  };

  // A no-op rAF: carries no flush work (the flush is synchronous in pushBytes),
  // so it never runs a parse inside a vsync and can't clash with xterm's render
  // rAF. It only asserts needsBeginFrame so Chrome's compositor never
  // hibernates the frame loop between animation frames. Re-arm within
  // OUTPUT_KEEP_WARM_MS of the last output; let it lapse once output is idle so
  // a static terminal rests. Keep-warm is visible-only: a hidden tab renders
  // nothing and flushes synchronously in pushBytes, so there is no frame loop
  // to keep warm while hidden.
  private onKeepWarm = () => {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      this.keepWarmFrameId = null;
      if (performanceNow() - this.lastOutputAtMs < OUTPUT_KEEP_WARM_MS) {
        this.keepWarmFrameId = requestAnimationFrame(this.onKeepWarm);
      }
    } finally {
      this.isDispatching = false;
    }
  };

  // xterm mutates its live buffer while DEC 2026 suppresses rendering. If its
  // 12ms parser slice enters the next frame before the prior render rAF runs,
  // that completed frame becomes unpresentable. Release queued bytes only after
  // the end-containing write parses and that already-scheduled render rAF runs.
  private cancelSynchronizedFrameWait = () => {
    this.synchronizedFrameGeneration += 1;
    this.awaitingSynchronizedFrameRender = false;
    if (this.synchronizedFrameReleaseId === null) return;
    cancelAnimationFrame(this.synchronizedFrameReleaseId);
    this.synchronizedFrameReleaseId = null;
  };

  private waitForSynchronizedFrameRender = (terminal: XtermTerminal, generation: number) => {
    if (
      this.terminal !== terminal ||
      this.synchronizedFrameGeneration !== generation ||
      !this.awaitingSynchronizedFrameRender
    ) {
      return;
    }
    if (isDocumentHidden()) {
      this.releaseSynchronizedFrame(terminal, generation);
      return;
    }
    this.synchronizedFrameReleaseId = requestAnimationFrame(() => {
      this.releaseSynchronizedFrame(terminal, generation);
    });
  };

  private releaseSynchronizedFrame = (terminal: XtermTerminal, generation: number) => {
    if (
      this.terminal !== terminal ||
      this.synchronizedFrameGeneration !== generation ||
      !this.awaitingSynchronizedFrameRender
    ) {
      return;
    }
    this.synchronizedFrameReleaseId = null;
    this.awaitingSynchronizedFrameRender = false;
    const didRenderImmediately = this.flushPending();
    if (!isDocumentHidden() && !didRenderImmediately) this.armKeepWarm();
  };

  private consumeSynchronizedFramePacingBypass = (endsSynchronizedOutput: boolean): boolean => {
    if (!endsSynchronizedOutput) return false;
    const elapsedSinceInputMs = performanceNow() - this.synchronizedFramePacingBypassAtMs;
    this.synchronizedFramePacingBypassAtMs = Number.NEGATIVE_INFINITY;
    return elapsedSinceInputMs >= 0 && elapsedSinceInputMs <= INTERACTIVE_OUTPUT_RENDER_WINDOW_MS;
  };

  private consumeInteractiveRender = (byteLength: number): boolean => {
    if (this.lastUserInputAtMs === Number.NEGATIVE_INFINITY) return false;
    const elapsedSinceInputMs = performanceNow() - this.lastUserInputAtMs;
    this.lastUserInputAtMs = Number.NEGATIVE_INFINITY;
    return (
      this.interactiveRenderingEnabled &&
      !isDocumentHidden() &&
      byteLength <= INTERACTIVE_OUTPUT_RENDER_MAX_BYTES &&
      elapsedSinceInputMs >= 0 &&
      elapsedSinceInputMs <= INTERACTIVE_OUTPUT_RENDER_WINDOW_MS
    );
  };

  private flushInteractiveRender = (terminal: XtermTerminal) => {
    if (this.terminal !== terminal || !this.interactiveRenderingEnabled) return;
    flushPendingInteractiveRender(terminal);
  };

  private flushPending = (bypassSynchronizedFramePacing = false): boolean => {
    const terminal = this.terminal;
    if (
      !terminal ||
      this.pendingWrites.length === 0 ||
      (this.awaitingSynchronizedFrameRender && !bypassSynchronizedFramePacing)
    ) {
      return false;
    }

    let didRenderImmediately = false;
    while (
      this.pendingWrites.length > 0 &&
      (!this.awaitingSynchronizedFrameRender || bypassSynchronizedFramePacing)
    ) {
      const pendingWrite = this.pendingWrites.shift();
      if (!pendingWrite) break;
      const shouldRenderImmediately = this.consumeInteractiveRender(pendingWrite.bytes.byteLength);
      const shouldBypassSynchronizedFramePacing = this.consumeSynchronizedFramePacingBypass(
        pendingWrite.endsSynchronizedOutput,
      );
      const shouldPaceNextSynchronizedFrame =
        pendingWrite.endsSynchronizedOutput &&
        !bypassSynchronizedFramePacing &&
        !isDocumentHidden() &&
        !shouldRenderImmediately &&
        !shouldBypassSynchronizedFramePacing;
      let synchronizedFrameGeneration = 0;
      if (shouldPaceNextSynchronizedFrame) {
        this.awaitingSynchronizedFrameRender = true;
        synchronizedFrameGeneration = ++this.synchronizedFrameGeneration;
      }
      const afterWrite =
        shouldRenderImmediately || shouldPaceNextSynchronizedFrame
          ? () => {
              if (shouldRenderImmediately) this.flushInteractiveRender(terminal);
              if (shouldPaceNextSynchronizedFrame) {
                this.waitForSynchronizedFrameRender(terminal, synchronizedFrameGeneration);
              }
            }
          : undefined;
      terminal.write(pendingWrite.bytes, afterWrite);
      this.afterFlush?.();
      didRenderImmediately ||= shouldRenderImmediately;
    }
    return didRenderImmediately;
  };
}

const outputBatcher = new OutputBatcher();

export { OutputBatcher, outputBatcher };
