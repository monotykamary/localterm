import {
  OUTPUT_BATCHER_INITIAL_CAPACITY_BYTES,
  OUTPUT_FLUSH_IDLE_MS,
  OUTPUT_FLUSH_SIZE_CAP_BYTES,
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
  // Idle-debounce flush timer (a macrotask, NOT a rAF). Reset on every arriving
  // byte so it fires OUTPUT_FLUSH_IDLE_MS after the LAST byte of a burst,
  // coalescing a multi-message burst into one terminal.write. Macrotask (not
  // vsync) so xterm's parse never runs inside a render-rAF deadline.
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  // No-op vsync commit that keeps Chrome's compositor frame loop warm across
  // the gaps between animation frames (see armKeepWarm). Carries no work — the
  // flush is the macrotask above — so it can't starve the render rAF.
  private keepWarmFrameId: number | null = null;
  private lastOutputAtMs = 0;
  private afterFlush: (() => void) | null = null;
  // Re-entrancy guard. Test rAF stubs fire the callback synchronously inside
  // requestAnimationFrame, which would infinite-recurse via the keep-warm
  // re-arm. The flag is checked at entry: a synchronous inner fire skips; the
  // next vsync (or time advance in tests) picks up the re-arm the outer set.
  private isDispatching = false;

  attach = (terminal: XtermTerminal) => {
    this.terminal = terminal;
  };

  setAfterFlush = (callback: (() => void) | null) => {
    this.afterFlush = callback;
  };

  detach = () => {
    this.cancelFlushTimer();
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
      this.cancelFlushTimer();
      this.flushPending();
      return;
    }
    // Visible. Small interactive output (a terminal query, keystroke echo, a
    // prompt redraw) — gated on the INCOMING write size, not the staged total
    // — is flushed synchronously so xterm parses and answers any query in the
    // same task, even when the write lands atop a staged high-throughput batch
    // (the staged bytes flush with it). The probing program reads the response
    // before its short read timeout, instead of the response arriving after the
    // timeout and leaking as typed input (e.g. `62;4;9;22c` after closing a TUI
    // switched to via the session picker, where the attach-time resize re-probes
    // the terminal). xterm parses a write at or below the threshold within its
    // 12ms synchronous budget. Large incoming writes (sustained renders, big
    // redraws) exceed the threshold and keep the idle-debounce coalescing for
    // throughput, so a firehose stream staging in the buffer never delays an
    // interactive write that lands on top of it.
    if (bytes.byteLength <= OUTPUT_SYNC_FLUSH_MAX_BYTES) {
      this.cancelFlushTimer();
      this.flushPending();
      this.armKeepWarm();
      return;
    }
    // A continuous high-throughput stream never goes idle, so the idle-debounce
    // timer would hold it indefinitely. Cap a staged batch at a no-yield parse
    // size (see OUTPUT_FLUSH_SIZE_CAP_BYTES) and flush immediately — the stream
    // flushes ~60×/sec, one write per render rAF, without per-message plumbing
    // overhead and without xterm spilling to its async drain (no partial paint).
    if (this.byteLength >= OUTPUT_FLUSH_SIZE_CAP_BYTES) {
      this.cancelFlushTimer();
      this.flushPending();
      this.armKeepWarm();
      return;
    }
    // Large frame: stage until the burst ends (idle gap) then commit in one
    // write. Resetting the timer on every arriving byte extends the stage
    // across the whole burst, so a single redraw the server coalesced into one
    // message (or a stream's back-to-back messages) coalesces into one atomic
    // write instead of painting chunk-by-chunk. The flush is a macrotask, so
    // xterm's parse runs here outside any vsync and the render rAF keeps the
    // full frame budget for its paint.
    this.resetFlushTimer();
    this.armKeepWarm();
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

  private resetFlushTimer = () => {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushPending();
    }, OUTPUT_FLUSH_IDLE_MS);
  };

  private cancelFlushTimer = () => {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  };

  // Re-arm a no-op vsync commit after a flush so a run of small interactive
  // frames keeps the compositor's frame loop warm (a hidden-tab hibernation
  // here would stall the next frame ~100ms). The armed rAF's onKeepWarm finds
  // the buffer empty (already flushed), no-ops, and re-arms within
  // OUTPUT_KEEP_WARM_MS — the same keep-warm loop the staged path runs, just
  // seeded here. No-op when output has lapsed past the window.
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

  // A single rAF callback serves only the keep-warm role now: it carries no
  // flush work (the flush is the idle-debounce macrotask), so it never runs a
  // parse inside a vsync and can't clash with xterm's render rAF. It only
  // asserts needsBeginFrame. Re-arm within OUTPUT_KEEP_WARM_MS of the last
  // output so Chrome's compositor never hibernates the frame loop between
  // animation frames; let it lapse once output is genuinely idle so a static
  // terminal rests. Keep-warm is visible-only: a hidden tab renders nothing
  // and is flushed synchronously in pushBytes, so there is no frame loop to
  // keep warm while hidden.
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
    // xterm's WriteBuffer retains the input bytes across an async yield while it
    // drains its parser, so hand over a private copy rather than a view into the
    // mutable staging buffer that the next push() will overwrite.
    terminal.write(this.buffer.subarray(0, byteLength).slice());
    this.afterFlush?.();
  };
}

const outputBatcher = new OutputBatcher();

export { OutputBatcher, outputBatcher };
