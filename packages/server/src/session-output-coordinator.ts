import {
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_OUTPUT_BYTES,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
} from "./constants.js";
import type { ManagedSession } from "./session-manager.js";
import { SessionOutputTransport } from "./session-output-transport.js";
import { getBufferedAmount } from "./utils/ws-socket.js";
import { stripAnsi } from "./utils/strip-ansi.js";

interface SessionOutputCoordinatorOptions {
  outputTransport: SessionOutputTransport;
  noteOutputActivity: (pid: number) => void;
  onOutputActivity: () => void;
}

export class SessionOutputCoordinator {
  private readonly outputTransport: SessionOutputTransport;
  private readonly noteOutputActivity: (pid: number) => void;
  private readonly onOutputActivity: () => void;

  constructor({
    outputTransport,
    noteOutputActivity,
    onOutputActivity,
  }: SessionOutputCoordinatorOptions) {
    this.outputTransport = outputTransport;
    this.noteOutputActivity = noteOutputActivity;
    this.onOutputActivity = onOutputActivity;
  }

onSessionOutput(managed: ManagedSession, data: string): void {
  const didEndSynchronizedOutput = managed.synchronizedOutputEndDetector.push(data);
  managed.outputBatch += data;
  managed.lastOutputAt = Date.now();
  if (managed.automation) this.appendAutomationLog(managed, data);
  this.noteOutputActivity(managed.session.pid);
  this.onOutputActivity();
  // Keep the capture renderer (if one exists) in lockstep with the PTY so a
  // later capture-pane reads current rendered text. Lazily created, so this
  // is a no-op for sessions nobody has captured (the common browser case).
  managed.captureRenderer?.write(data);
  // DEC synchronized output supplies the exact safe redraw boundary. Flush
  // when DECRST 2026 arrives instead of waiting for the idle fallback, while
  // unsynchronized output keeps the existing anti-flicker window unchanged.
  if (didEndSynchronizedOutput || managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
    if (managed.outputBatchTimer !== null) {
      clearTimeout(managed.outputBatchTimer);
      managed.outputBatchTimer = null;
    }
    this.flushOutput(managed);
    return;
  }
  // Without a synchronized-output boundary, reset the coalescing window on
  // every chunk so the flush lands OUTPUT_BATCH_WINDOW_MS after the LAST
  // chunk of a burst, not a fixed window after the first. A full-screen TUI
  // redraw of a large session emits across more than the window (node-pty
  // delivers it as many 1024-byte data events over successive event-loop
  // turns); a one-shot window flushed mid-redraw and split the frame across
  // multiple WebSocket messages. Over a bandwidth-limited link each split
  // arrives as its own atomic message and xterm paints it separately — the
  // visible top-to-bottom crawl. A resetting window holds the whole burst until the
  // PTY goes idle, then sends one message; the browser receives it atomically
  // and xterm renders it in a single paint regardless of link bandwidth.
  // Sustained high-throughput output never idles, so OUTPUT_BATCH_FLUSH_BYTES
  // still gates the message rate there (unchanged).
  if (managed.outputBatchTimer !== null) {
    managed.outputBatchTimer.refresh();
    return;
  }
  managed.outputBatchTimer = setTimeout(() => {
    managed.outputBatchTimer = null;
    this.flushOutput(managed);
  }, OUTPUT_BATCH_WINDOW_MS);
  managed.outputBatchTimer.unref?.();
}

// Accumulate ANSI-stripped PTY output for an automation shell run, keeping
// the tail within the log cap so a long command's final output survives.
private appendAutomationLog(managed: ManagedSession, data: string): void {
  const stripped = stripAnsi(data);
  if (stripped.length === 0) return;
  const combined = managed.automationLog + stripped;
  if (combined.length <= MAX_AUTOMATION_LOG_LENGTH) {
    managed.automationLog = combined;
    return;
  }
  const overflow = combined.length - MAX_AUTOMATION_LOG_LENGTH;
  managed.automationLog = combined.slice(overflow);
}

flushOutput(managed: ManagedSession): void {
  const batch = managed.outputBatch;
  managed.outputBatch = "";
  if (!batch) return;
  const bytes = Buffer.from(batch, "utf8");
  if (bytes.byteLength <= MAX_OUTPUT_BYTES) {
    this.outputTransport.broadcastBytes(managed, bytes);
  } else {
    for (let offset = 0; offset < bytes.byteLength; offset += MAX_OUTPUT_BYTES) {
      this.outputTransport.broadcastBytes(managed, bytes.subarray(offset, offset + MAX_OUTPUT_BYTES));
    }
  }
  this.maybePauseAfterFlush(managed);
}

private maybePauseAfterFlush(managed: ManagedSession): void {
  if (managed.session.isPaused) return;
  for (const client of managed.clients) {
    if (client.pending) continue;
    if (getBufferedAmount(client.ws) >= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES) {
      managed.session.pause();
      this.ensureDrainPoll(managed);
      return;
    }
  }
}

private ensureDrainPoll(managed: ManagedSession): void {
  if (managed.drainPollTimer !== null) return;
  managed.drainPollTimer = setInterval(() => {
    if (!managed.session.isPaused) {
      this.stopDrainPoll(managed);
      return;
    }
    let allLow = true;
    for (const client of managed.clients) {
      if (client.pending) continue;
      if (getBufferedAmount(client.ws) > WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
        allLow = false;
        break;
      }
    }
    if (allLow) {
      managed.session.resume();
      this.stopDrainPoll(managed);
    }
  }, WS_OUTBOUND_DRAIN_POLL_MS);
  managed.drainPollTimer.unref?.();
}

stopDrainPoll(managed: ManagedSession): void {
  if (managed.drainPollTimer === null) return;
  clearInterval(managed.drainPollTimer);
  managed.drainPollTimer = null;
}

}
