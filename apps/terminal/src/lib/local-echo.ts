import type { Terminal as XtermTerminal } from "@xterm/xterm";
import {
  LOCAL_ECHO_BURST_IDLE_MS,
  LOCAL_ECHO_COOLDOWN_MS,
  DEFAULT_TERMINAL_LOCAL_ECHO,
  LOCAL_ECHO_PENDING_MAX_CHARS,
  LOCAL_ECHO_RTT_EMA_ALPHA,
  LOCAL_ECHO_RTT_STALE_MS,
  LOCAL_ECHO_THRESHOLD_MS,
  LOCAL_ECHO_TIMEOUT_MS,
} from "@/lib/constants";

const BACKSPACE = "\b";
const CURSOR_FORWARD = "\x1b[C";
const DIM_OFF = "\x1b[22m";
const DIM_ON = "\x1b[2m";
const SPACE = " ";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

interface LocalEchoOptions {
  terminal: XtermTerminal;
  send: (data: string) => void;
  isSafeState: () => boolean;
}

// Predicted keystrokes are matched against the real echo by UTF-16 code unit so
// a single re-encoded char compares equal before and after the wire round-trip.
const commonPrefixLength = (left: string, right: string): number => {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left.charCodeAt(index) === right.charCodeAt(index)) {
    index += 1;
  }
  return index;
};

// Only single-cell printable keystrokes are worth predicting: one code point,
// in the ASCII printable or Latin-1 printable ranges (both render exactly one
// cell, so the cursor math holds). Wide chars, combining marks, pastes and
// every control sequence round-trip and let the reconciler handle their echo.
const isSingleCellPrintable = (chunk: string): boolean => {
  if ([...chunk].length !== 1) return false;
  const code = chunk.codePointAt(0) ?? 0;
  return (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff);
};

// A cursor-moving control (arrow, backspace, Ctrl-U, Enter, Tab, Ctrl-C) starts
// with a C0 control byte or DEL. Such a keystroke moves the shell's logical
// cursor without a matching xterm cursor move from us (we don't predict
// controls), so the two desync until the control's echo arrives.
const isControlChunk = (chunk: string): boolean => {
  const code = chunk.charCodeAt(0) ?? 0x100;
  return code < 0x20 || code === 0x7f;
};

const nextEma = (prev: number | null, sample: number): number =>
  prev === null
    ? sample
    : prev * (1 - LOCAL_ECHO_RTT_EMA_ALPHA) + sample * LOCAL_ECHO_RTT_EMA_ALPHA;

// Client-side predictive echo for high-latency links (a tailnet over a DERP
// relay, a phone on cellular). Each printable keystroke is written to xterm in
// a faint "unconfirmed" style immediately; the server's real echo later
// overwrites it in normal intensity. A self-measured round-trip time gates
// prediction off on fast links (where it would only add a per-keystroke flash)
// and on when latency crosses the threshold, so the common local surface is
// unchanged. Reconciliation is a streaming prefix match between the expected
// echo (pending) and the real output, with a cursor-forward fixup so chunked
// echoes arriving in pieces don't desync the "predicted span sits just before
// the cursor" invariant. A mismatch (a syntax-highlighting shell that reprints
// the line, a stray control byte) erases the pending span and defers to the
// real output. The safe-state gate (no foreground program + normal buffer)
// keeps prediction out of TUIs and raw-mode programs, and a watchdog erases any
// unconfirmed span so a misdetected no-echo prompt can never leave typed text
// visible.
export class LocalEcho {
  private readonly terminal: XtermTerminal;
  private readonly send: (data: string) => void;
  private readonly isSafeState: () => boolean;

  private enabled = DEFAULT_TERMINAL_LOCAL_ECHO;
  private pending = "";
  private lastInputMs = -1_000_000;
  private emaRttMs: number | null = null;
  private lastRttSampleMs = 0;
  private probeSendMs: number | null = null;
  private probeInFlight = false;
  private suspended = false;
  private cooldownUntilMs = 0;
  private timeoutHandle: number | null = null;

  constructor(options: LocalEchoOptions) {
    this.terminal = options.terminal;
    this.send = options.send;
    this.isSafeState = options.isSafeState;
  }

  setEnabled = (enabled: boolean): void => {
    this.enabled = enabled;
    if (!enabled) this.flush();
  };

  handleInput = (chunk: string): void => {
    if (!this.enabled) {
      this.send(chunk);
      return;
    }
    const now = performance.now();
    const burstStart = now - this.lastInputMs > LOCAL_ECHO_BURST_IDLE_MS;
    if (burstStart) {
      this.probeInFlight = false;
      this.suspended = false;
    }
    this.lastInputMs = now;
    if (isControlChunk(chunk)) {
      // A cursor-moving control leaves xterm's cursor out of sync with the
      // shell's logical cursor until its echo arrives. Suspend prediction so
      // the next printable doesn't render at the wrong column; the control's
      // echo resyncs the geometry and clears the suspension.
      this.suspended = true;
      this.send(chunk);
      return;
    }
    if (
      now < this.cooldownUntilMs ||
      this.suspended ||
      !this.isSafeState() ||
      !isSingleCellPrintable(chunk) ||
      this.pending.length >= LOCAL_ECHO_PENDING_MAX_CHARS
    ) {
      this.send(chunk);
      return;
    }
    const decision = this.decide(now, burstStart);
    if (decision === "skip") {
      this.send(chunk);
      return;
    }
    if (decision === "probe") {
      this.probeSendMs = now;
      this.probeInFlight = true;
    }
    this.terminal.write(DIM_ON + chunk + DIM_OFF);
    this.send(chunk);
    this.pending += chunk;
    this.rearmTimeout();
  };

  // Transforms a real output chunk against the pending prediction and returns
  // the bytes to write to xterm. Passthrough when nothing is pending keeps the
  // common (non-predicting) path at zero cost.
  reconcile = (bytes: Uint8Array): Uint8Array => {
    if (this.pending.length === 0) {
      // Real output with nothing predicted: the terminal's geometry is
      // authoritative, so a prior control's echo has resynced the cursor.
      this.suspended = false;
      return bytes;
    }
    const real = decoder.decode(bytes);
    const total = this.pending.length;
    const matched = commonPrefixLength(real, this.pending);
    if (matched > 0 && this.probeSendMs !== null) {
      const now = performance.now();
      this.emaRttMs = nextEma(this.emaRttMs, now - this.probeSendMs);
      this.lastRttSampleMs = now;
      this.probeSendMs = null;
      this.probeInFlight = false;
    }
    // The real output bytes are passed through verbatim so a multi-byte UTF-8
    // char split across frames still assembles correctly in xterm; only the
    // cursor/erase prefixes are synthesized (ASCII, so they encode losslessly).
    let prefix: string;
    let suffix: string;
    if (matched === total) {
      // Full match: rewind to the span start and let real overwrite every dim
      // cell in normal intensity. Any trailing bytes are non-echo output.
      this.pending = "";
      prefix = BACKSPACE.repeat(total);
      suffix = "";
    } else if (matched === real.length) {
      // Partial: real is a prefix of pending (chunked echo). Confirm the head
      // (the real bytes overwrite the first matched dim cells), then advance
      // the cursor forward over the remaining dim cells so the span still
      // ends just before the cursor for the next chunk.
      this.pending = this.pending.slice(matched);
      prefix = BACKSPACE.repeat(total);
      suffix = CURSOR_FORWARD.repeat(total - matched);
    } else {
      // Mismatch: real diverges mid-span or opens with an escape (a reprinting
      // shell). Erase the dim span and let the real output author the line.
      this.pending = "";
      this.probeSendMs = null;
      this.probeInFlight = false;
      prefix = BACKSPACE.repeat(total) + SPACE.repeat(total) + BACKSPACE.repeat(total);
      suffix = "";
    }
    if (this.pending.length === 0) {
      this.suspended = false;
      this.cancelTimeout();
    } else {
      this.rearmTimeout();
    }
    return suffix.length === 0
      ? concatBytes(encoder.encode(prefix), bytes)
      : concatBytes(encoder.encode(prefix), bytes, encoder.encode(suffix));
  };

  hasPending = (): boolean => this.pending.length > 0;

  // Erases any unconfirmed prediction and drops the pending state. Called on
  // session switch, socket close, disable, and watchdog expiry.
  flush = (): void => {
    if (this.pending.length === 0) return;
    const total = this.pending.length;
    this.terminal.write(BACKSPACE.repeat(total) + SPACE.repeat(total) + BACKSPACE.repeat(total));
    this.pending = "";
    this.probeSendMs = null;
    this.probeInFlight = false;
    this.suspended = false;
    this.cancelTimeout();
  };

  dispose = (): void => {
    this.flush();
  };

  // "probe" predicts the first keystroke of an idle burst to (re)measure RTT
  // when the estimate is unknown or stale; "predict" runs once the link is known
  // slow; "skip" passes through (fast link, or still measuring).
  private decide = (now: number, burstStart: boolean): "probe" | "predict" | "skip" => {
    const rttStale = this.emaRttMs === null || now - this.lastRttSampleMs > LOCAL_ECHO_RTT_STALE_MS;
    if (burstStart && rttStale) return "probe";
    // A probe is in flight (first keystroke of a burst, echo not yet back):
    // optimistically predict the rest of the burst. On a fast link the dim is
    // overwritten within a frame (invisible); on a slow link it persists (the
    // point). The gate still wins for spaced typing: once the probe's echo
    // arrives and the RTT is known fast, subsequent bursts skip.
    if (this.probeInFlight) return "predict";
    if (this.emaRttMs === null) return "skip";
    return this.emaRttMs > LOCAL_ECHO_THRESHOLD_MS ? "predict" : "skip";
  };

  private rearmTimeout = (): void => {
    this.cancelTimeout();
    this.armTimeout();
  };

  private armTimeout = (): void => {
    if (this.timeoutHandle !== null) return;
    this.timeoutHandle = window.setTimeout(() => {
      this.timeoutHandle = null;
      if (this.pending.length > 0) {
        this.flush();
        this.cooldownUntilMs = performance.now() + LOCAL_ECHO_COOLDOWN_MS;
      }
    }, LOCAL_ECHO_TIMEOUT_MS);
  };

  private cancelTimeout = (): void => {
    if (this.timeoutHandle !== null) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
  };
}
