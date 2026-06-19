import {
  MAX_WRITE_PER_FRAME_BYTES,
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_KEEP_WARM_MS,
} from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const performanceNow = () => performance.now();

// xterm's WriteBuffer defers terminal.write via setTimeout(0) by default. Only
// the first write following genuine user input is synchronous — rAF-driven
// writes (our case) always take the deferred path, so the rAF that called
// write returns BEFORE the parse ran; the grid mutation lands on a later
// event-loop turn, after the compositor already committed the rAF's frame
// with the unchanged grid, committing the new state one or two vsyncs late.
// Traced in trace6: 732 setTimeout(0) installs/sec, every one with the stack
// write -> _scheduleInnerWrite -> cancelAndSet(fn, 0). Setting _didUserInput
// true before write routes xterm through the synchronous _innerWrite() branch
// instead: parse begins inside the write call itself. The field is private but
// preserved verbatim in @xterm/xterm's shipped bundle (no private-name
// mangling); reaching it is the cleanest surgical route — flushSync has the
// same effect but discards parse()'s async-handler Promise return, which can
// strand the internal _parseStack continuation state.
interface XtermWriteBuffer {
  _didUserInput?: boolean;
}
interface XtermCore {
  // The Terminal core holds _writeBuffer (the WriteBuffer instance) and
  // _inputHandler (the InputHandler) as siblings — _inputHandler does NOT
  // own _writeBuffer.
  _writeBuffer?: XtermWriteBuffer;
}
interface XtermTerminalWithCore extends XtermTerminal {
  _core?: XtermCore;
}

const writeSynchronously = (terminal: XtermTerminal, bytes: Uint8Array) => {
  const writeBuffer = (terminal as XtermTerminalWithCore)._core?._writeBuffer;
  if (writeBuffer) writeBuffer._didUserInput = true;
  terminal.write(bytes);
};

class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private buffer = new Uint8Array(OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES);
  private byteLength = 0;
  // Cursor into the staging buffer for the next per-frame handoff. When arrival
  // rate exceeds MAX_WRITE_PER_FRAME_BYTES per rAF, we cap the write size and
  // carry the remainder forward — keeping each terminal.write()'s parse under
  // xterm's 12ms sync budget so the grid mutates within the rAF that issued it.
  private writeStartOffset = 0;
  private animationFrameId: number | null = null;
  private lastOutputAtMs = 0;
  private afterFlush: (() => void) | null = null;

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
    this.flushAllRemaining();
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
    // Guard against duplicate rAF registration. The keep-warm re-arm goes
    // through setTimeout(0) (to break synchronization with test stubs), so
    // there's a window between onFrame returning and the deferred scheduleFrame
    // call during which pushBytes could land and schedule its own rAF. Without
    // this guard, the deferred re-arm would register a second rAF for the same
    // vsync, and each onFrame callback at that vsync would queue its own
    // setTimeout — doubling the rAF count every vsync in production.
    if (this.animationFrameId !== null) return;
    this.animationFrameId = requestAnimationFrame(this.onFrame);
  };

  // A single rAF callback serves two roles: flush pending output, and (when the
  // buffer is empty) act as a no-op vsync commit that keeps needsBeginFrame
  // asserted. Re-arm within OUTPUT_KEEP_WARM_MS of the last output so Chrome's
  // compositor never hibernates the frame loop between animation frames; let it
  // lapse once output is genuinely idle so a static terminal rests. Also re-arm
  // whenever a capped frame left remainder queued — otherwise the terminal
  // sticks at a partial screen for the rest of the keep-warm window.
  private onFrame = () => {
    this.animationFrameId = null;
    this.flushPending();
    if (
      this.writeStartOffset < this.byteLength ||
      performanceNow() - this.lastOutputAtMs < OUTPUT_KEEP_WARM_MS
    ) {
      // Defer the re-arm to the next event-loop turn. Some test rAF stubs call
      // the callback synchronously from inside requestAnimationFrame, which
      // would otherwise infinite-recurse via the keep-warm re-arm. Production
      // rAF is async (fires at the next vsync), so the defer adds microseconds
      // and the next rAF still fires before the next vsync — keep-warm cadence
      // is unchanged.
      setTimeout(this.scheduleFrame, 0);
    }
  };

  private flushPending = () => {
    if (this.writeStartOffset >= this.byteLength) {
      this.byteLength = 0;
      this.writeStartOffset = 0;
      return;
    }
    const remaining = this.byteLength - this.writeStartOffset;
    const chunkSize = Math.min(remaining, MAX_WRITE_PER_FRAME_BYTES);
    const start = this.writeStartOffset;
    const end = start + chunkSize;
    this.writeStartOffset = end;
    this.writeChunk(start, end);
    this.afterFlush?.();
    // Reset the staging window once everything has drained so pushBytes can
    // start fresh at offset 0. Without this, writeStartOffset and byteLength
    // climb in lockstep under sustained heavy output and ensureCapacity keeps
    // doubling the backing Uint8Array even though only the tail is in use.
    if (this.writeStartOffset >= this.byteLength) {
      this.byteLength = 0;
      this.writeStartOffset = 0;
    }
  };

  // Detach path: drain everything synchronously, skipping the per-frame cap.
  // Skipping the cap is correct at teardown — the terminal is going away so a
  // long main-thread block is the lesser evil vs. truncating buffered output
  // across rAFs that will never fire again.
  private flushAllRemaining = () => {
    const terminal = this.terminal;
    const byteLength = this.byteLength;
    this.byteLength = 0;
    this.writeStartOffset = 0;
    if (!terminal || byteLength === 0) return;
    this.writeChunk(0, byteLength);
    this.afterFlush?.();
  };

  private writeChunk = (start: number, end: number) => {
    const terminal = this.terminal;
    if (!terminal) return;
    // slice() copies so xterm's WriteBuffer can keep referencing the bytes
    // across any async parse yield without seeing a buffer the next pushBytes
    // call has already overwritten.
    writeSynchronously(terminal, this.buffer.subarray(start, end).slice());
  };
}

const outputBatcher = new OutputBatcher();

export { outputBatcher };
