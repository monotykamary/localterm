import { OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES, OUTPUT_KEEP_WARM_MS } from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const performanceNow = () => performance.now();

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private buffer = new Uint8Array(OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES);
  private byteLength = 0;
  private animationFrameId: number | null = null;
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
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
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
    if (this.animationFrameId !== null) return;
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
    this.animationFrameId = requestAnimationFrame(this.onFrame);
  };

  // A single rAF callback serves two roles: flush pending output, and (when the
  // buffer is empty) act as a no-op vsync commit that keeps needsBeginFrame
  // asserted. Re-arm within OUTPUT_KEEP_WARM_MS of the last output so Chrome's
  // compositor never hibernates the frame loop between animation frames; let it
  // lapse once output is genuinely idle so a static terminal rests.
  private onFrame = () => {
    if (this.isDispatching) return;
    this.isDispatching = true;
    try {
      this.animationFrameId = null;
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
