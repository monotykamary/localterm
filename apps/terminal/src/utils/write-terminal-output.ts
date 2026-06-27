import {
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
  OUTPUT_SYNC_FLUSH_MAX_BYTES,
} from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const performanceNow = () => performance.now();

const isDocumentHidden = (): boolean => typeof document !== "undefined" && document.hidden;

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private buffer = new Uint8Array(OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES);
  private byteLength = 0;
  private pendingFrameId: number | null = null;
  private lastOutputAtMs = 0;
  private afterFlush: (() => void) | null = null;
  // Re-entrancy guard. The keep-warm re-arm at the bottom of onFrame schedules
  // the next rAF; in production that's async so onFrame finishes before the
  // next call. But test rAF stubs typically fire the callback synchronously
  // from inside requestAnimationFrame, which would infinite-recurse via the
  // keep-warm branch (RangeError: Maximum call stack size exceeded). The flag
  // is checked at entry: if onFrame fires synchronously while we're still
  // dispatching the outer call, the inner one skips — the next vsync (or
  // time advance in tests) will pick up the keep-warm arm the outer call set.
  private isDispatching = false;

  attach = (terminal: XtermTerminal) => {
    this.terminal = terminal;
  };

  setAfterFlush = (callback: (() => void) | null) => {
    this.afterFlush = callback;
  };

  detach = () => {
    if (this.pendingFrameId !== null) {
      cancelAnimationFrame(this.pendingFrameId);
      this.pendingFrameId = null;
    }
    this.flushPending();
    this.terminal = null;
    this.afterFlush = null;
  };

  // Output frames arrive as raw UTF-8 bytes (a binary WebSocket frame), so the
  // staging path is a straight memcpy into the backing buffer — no string
  // roundtrip, no TextEncoder. xterm parses UTF-8 natively.
  pushBytes = (bytes: Uint8Array) => {
    this.appendBytes(bytes);
    this.lastOutputAtMs = performanceNow();
    // A backgrounded browser tab pauses requestAnimationFrame entirely and
    // throttles setTimeout to ~1Hz, so deferring the flush to either timer
    // while the tab is hidden delays xterm's parse of a terminal query past
    // the probing program's read timeout — and xterm's response then leaks
    // into the shell as typed text (e.g. `62;4;9;22c` on switching tabs back).
    // xterm's terminal.write parses a small write synchronously within its
    // 12ms budget (only large writes spill to its own async drain), so
    // flushing immediately while hidden lets xterm answer the query in the
    // same task and the response reaches the PTY before the read times out.
    // There is no paint cost while hidden, so synchronous flushing is free.
    if (isDocumentHidden()) {
      this.cancelPendingFrame();
      this.flushPending();
      return;
    }
    // Visible. Small interactive output (a terminal query, keystroke echo, a
    // prompt redraw) is flushed synchronously so xterm parses and answers any
    // query in the same task — the probing program reads the response before
    // its short read timeout, instead of the response arriving after the
    // timeout and leaking as typed input (e.g. `62;4;9;22c` after closing a
    // TUI switched to via the session picker, where the attach-time resize
    // re-probes the terminal). xterm parses a write at or below the threshold
    // within its 12ms synchronous budget. Large buffers (sustained renders)
    // exceed the threshold and keep the rAF coalescing for throughput.
    if (this.byteLength <= OUTPUT_SYNC_FLUSH_MAX_BYTES) {
      this.cancelPendingFrame();
      this.flushPending();
      this.armKeepWarm();
      return;
    }
    if (this.pendingFrameId !== null) return;
    this.scheduleFrame();
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

  private scheduleFrame = () => {
    this.pendingFrameId = requestAnimationFrame(this.onFrame);
  };

  // Re-arm a no-op vsync commit after a synchronous flush so a run of small
  // interactive frames keeps the compositor's frame loop warm (a hidden-tab
  // hibernation here would stall the next frame ~100ms). The armed rAF's
  // onFrame finds the buffer empty (already flushed), no-ops the flush, and
  // re-arms within OUTPUT_KEEP_WARM_MS — the same keep-warm loop the rAF path
  // runs, just seeded here. No-op when output has lapsed past the window.
  private armKeepWarm = () => {
    if (this.pendingFrameId !== null) return;
    if (performanceNow() - this.lastOutputAtMs >= OUTPUT_KEEP_WARM_MS) return;
    this.scheduleFrame();
  };

  private cancelPendingFrame = () => {
    if (this.pendingFrameId === null) return;
    cancelAnimationFrame(this.pendingFrameId);
    this.pendingFrameId = null;
  };

  // A single rAF callback serves two roles: flush pending output, and (when the
  // buffer is empty) act as a no-op vsync commit that keeps needsBeginFrame
  // asserted. Re-arm within OUTPUT_KEEP_WARM_MS of the last output so Chrome's
  // compositor never hibernates the frame loop between animation frames; let it
  // lapse once output is genuinely idle so a static terminal rests. Keep-warm
  // is visible-only: a hidden tab renders nothing and is flushed synchronously
  // in pushBytes, so there is no frame loop to keep warm while hidden.
  private onFrame = () => {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      this.pendingFrameId = null;
      this.flushPending();
      if (performanceNow() - this.lastOutputAtMs < OUTPUT_KEEP_WARM_MS) {
        this.scheduleFrame();
      }
    } finally {
      this.isDispatching = false;
    }
  };

  private flushPending = () => {
    const terminal = this.terminal;
    const byteLength = this.byteLength;
    this.byteLength = 0;
    if (!terminal || byteLength === 0) return;
    // xterm's WriteBuffer retains the input bytes across an async yield while it
    // drains its parser, so hand over a private copy rather than a view into the
    // mutable staging buffer that the next push() will overwrite.
    terminal.write(this.buffer.subarray(0, byteLength).slice());
    this.afterFlush?.();
  };
}

const outputBatcher = new OutputBatcher();

export { OutputBatcher, outputBatcher };
