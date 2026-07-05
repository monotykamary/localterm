import { OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES, OUTPUT_KEEP_WARM_MS } from "@/lib/constants";
import type { Terminal as XtermTerminal } from "@xterm/xterm";

const performanceNow = () => performance.now();

const isDocumentHidden = (): boolean => typeof document !== "undefined" && document.hidden;

// One byte is enough to carry "this completes a render unit": the server sets it
// on a frame's idle-flush (frame end) and on a sustained-stream chunk, and
// leaves it off a mid-frame size-cap split so the client keeps staging. A
// back-compat server (or a non-staging reader) that never sends the marker just
// renders each message on arrival — the staged path degrades to raw in/out.
class OutputBatcher {
  private terminal: XtermTerminal | null = null;
  private buffer = new Uint8Array(OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES);
  private byteLength = 0;
  // No-op vsync commit that keeps Chrome's compositor frame loop warm across
  // the gaps between animation frames. Carries no parse work — the flush is
  // synchronous in flushStaged — so it can't starve xterm's render rAF.
  private keepWarmFrameId: number | null = null;
  private lastOutputAtMs = 0;
  private afterFlush: (() => void) | null = null;
  // Re-entrancy guard for test rAF stubs that fire the callback synchronously
  // inside requestAnimationFrame, which would infinite-recurse via the
  // keep-warm re-arm. Checked at entry: a synchronous inner fire skips; the
  // next vsync (or time advance in tests) picks up the re-arm the outer set.
  private isDispatching = false;

  attach = (terminal: XtermTerminal) => {
    this.terminal = terminal;
  };

  setAfterFlush = (callback: (() => void) | null) => {
    this.afterFlush = callback;
  };

  detach = () => {
    this.cancelKeepWarm();
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
    // Stage — do NOT flush on arrival. The server coalesces one logical TUI
    // frame into a burst of messages (capped at 64KB each, under xterm's 12ms
    // parse-yield budget) and marks the boundary with an output-flush control
    // after the last message; flushStaged commits the staged frame as one
    // terminal.write (one render). A frame the server split across messages
    // at the cap therefore stages every split and paints them together when
    // the end marker lands — no progressive top-to-bottom crawl over a
    // bandwidth-limited link (Face 1). A sustained stream's size-cap chunks
    // are each marked, so they flush progressively (a `cat` scrolls instead of
    // staging forever); a mid-frame size-cap split carries no marker, so the
    // client keeps staging until the frame's end marker. xterm parses a
    // <=64KB write within its 12ms synchronous budget, so a single staged
    // frame never spills to xterm's async drain (no partial paint). A
    // backgrounded browser tab pauses rAF and throttles setTimeout to ~1Hz,
    // but the marker arrives as its own WS message and flushes synchronously
    // here, so xterm still answers a terminal query before the probing
    // program's read times out. There is no paint cost while hidden.
    if (!isDocumentHidden()) this.armKeepWarm();
  };

  // Commit the staged output as one terminal.write. Called on the server's
  // output-flush marker (a frame end or a sustained-stream chunk). One render
  // per frame regardless of how many messages the server split it across or
  // how spread a bandwidth-limited link made their arrival.
  flushStaged = () => {
    this.flushPending();
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

  // Re-arm a no-op vsync commit after a stage so a run of frames keeps the
  // compositor's frame loop warm (a hidden-tab hibernation here would stall
  // the next frame ~100ms). The armed rAF's onKeepWarm finds the buffer
  // possibly still staged (the flush lands on the marker), no-ops, and
  // re-arms within OUTPUT_KEEP_WARM_MS. No-op when output has lapsed past the
  // window.
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

  // A no-op rAF: carries no flush work (the flush is synchronous in
  // flushStaged), so it never runs a parse inside a vsync and can't clash with
  // xterm's render rAF. It only asserts needsBeginFrame so Chrome's compositor
  // never hibernates the frame loop between animation frames. Re-arm within
  // OUTPUT_KEEP_WARM_MS of the last output; let it lapse once output is idle
  // so a static terminal rests. Keep-warm is visible-only: a hidden tab
  // renders nothing and stages/flushes synchronously, so there is no frame
  // loop to keep warm while hidden.
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

  private flushPending = () => {
    const terminal = this.terminal;
    const byteLength = this.byteLength;
    this.byteLength = 0;
    if (!terminal || byteLength === 0) return;
    terminal.write(this.buffer.subarray(0, byteLength).slice());
    this.afterFlush?.();
  };
}

const outputBatcher = new OutputBatcher();

export { OutputBatcher, outputBatcher };
