import fs from "node:fs";
import nodeFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_OUTPUT_BYTES,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  WS_OUTBOUND_DRAIN_POLL_MS,
  WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES,
  WS_OUTBOUND_RESUME_LOW_WATER_BYTES,
} from "./constants.js";
import { KittyApcScanner, type KittyMediumProbe } from "./kitty-apc-scanner.js";
import { KittyFrameFileRelay } from "./kitty-frame-file-relay.js";
import type { ManagedClient, ManagedSession } from "./session-manager.js";
import { SessionOutputTransport } from "./session-output-transport.js";
import { getBufferedAmount } from "./utils/ws-socket.js";
import { stripAnsi } from "./utils/strip-ansi.js";

interface SessionOutputCoordinatorOptions {
  outputTransport: SessionOutputTransport;
  noteOutputActivity: (pid: number) => void;
  onOutputActivity: () => void;
  // Writes a terminal-side reply directly into the session PTY — the daemon
  // answers kitty medium probes on the terminal's behalf.
  writeInput: (managed: ManagedSession, data: string) => void;
}

export class SessionOutputCoordinator {
  private readonly outputTransport: SessionOutputTransport;
  private readonly noteOutputActivity: (pid: number) => void;
  private readonly onOutputActivity: () => void;
  private readonly writeInput: (managed: ManagedSession, data: string) => void;
  private readonly frameRelay: KittyFrameFileRelay;
  // The real temp root used to validate frame paths pointed at by kitty file
  // medium messages (the scanner's allow-list). Resolved once: apps report
  // $TMPDIR-style paths (symlink-bearing on macOS), so only a realpath both
  // sides agree on is meaningful.
  private readonly tmpdirRoot: string;
  private readonly realpathCache = new Map<string, string>();
  private readonly scanners = new WeakMap<ManagedSession, KittyApcScanner>();

  constructor({
    outputTransport,
    noteOutputActivity,
    onOutputActivity,
    writeInput,
  }: SessionOutputCoordinatorOptions) {
    this.outputTransport = outputTransport;
    this.noteOutputActivity = noteOutputActivity;
    this.onOutputActivity = onOutputActivity;
    this.writeInput = writeInput;
    this.frameRelay = new KittyFrameFileRelay(outputTransport);
    this.tmpdirRoot = fs.realpathSync(os.tmpdir());
  }

  // Kitty file-medium frame paths are validated against the real temp root
  // (apps report $TMPDIR-style paths, which are symlink-bearing on macOS).
  // realpath results are cached: the ring of frame files is long-lived and
  // rewritten in place, so a per-frame lookup stays cheap.
  private isAllowedFramePath(name: string): boolean {
    let real = this.realpathCache.get(name);
    if (real === undefined) {
      try {
        real = fs.realpathSync(name);
      } catch {
        return false;
      }
      this.realpathCache.set(name, real);
    }
    return real.startsWith(this.tmpdirRoot + path.sep);
  }

  private scannerFor(managed: ManagedSession): KittyApcScanner {
    let scanner = this.scanners.get(managed);
    if (scanner) return scanner;
    scanner = new KittyApcScanner((name) => this.isAllowedFramePath(name));
    this.scanners.set(managed, scanner);
    return scanner;
  }

  // Only answer when every attached non-pending client's binary channel is
  // framed — answering a file-medium probe moves the app onto a transport a
  // legacy client can't render. With no framed viewer, leave the probe
  // unanswered; the app falls back inline.
  private canRelayFrames(managed: ManagedSession): boolean {
    let hasFramedViewer = false;
    for (const client of managed.clients) {
      if (client.pending) continue;
      if (!client.framingEnabled) return false;
      hasFramedViewer = true;
    }
    return hasFramedViewer;
  }

  private maybeAnswerProbe(managed: ManagedSession, probe: KittyMediumProbe): void {
    if (!this.canRelayFrames(managed)) return;
    void this.respondToProbe(managed, probe);
  }

  private async respondToProbe(managed: ManagedSession, probe: KittyMediumProbe): Promise<void> {
    let readable = false;
    try {
      const real = await nodeFs.realpath(probe.path);
      const stat = await nodeFs.stat(real);
      readable = stat.isFile() && real.startsWith(this.tmpdirRoot + path.sep);
    } catch {
      readable = false;
    }
    if (probe.quiet >= 2) return;
    if (readable && probe.quiet === 1) return;
    this.writeInput(
      managed,
      `\x1b_Gi=${probe.imageId};${readable ? "OK" : "ENOENT:unreadable"}\x1b\\`,
    );
  }

  onSessionOutput(managed: ManagedSession, data: string): void {
    // kitty file-medium sequences: probes are answered by the daemon (and
    // stripped so nothing else races a reply); named frame transmits pass
    // through while their pixels are relayed over the WS frame channel.
    const scan = this.scannerFor(managed).push(data);
    for (const probe of scan.probes) this.maybeAnswerProbe(managed, probe);
    for (const frame of scan.frames) this.frameRelay.push(managed, frame, this.tmpdirRoot);
    const output = scan.output;
    const didEndSynchronizedOutput = managed.synchronizedOutputEndDetector.push(output);
    managed.outputBatch += output;
    managed.lastOutputAt = Date.now();
    if (managed.automation) this.appendAutomationLog(managed, output);
    this.noteOutputActivity(managed.session.pid);
    this.onOutputActivity();
    // Keep the capture renderer (if one exists) in lockstep with the PTY so a
    // later capture-pane reads current rendered text. Lazily created, so this
    // is a no-op for sessions nobody has captured (the common browser case).
    managed.captureRenderer?.write(output);
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
        this.outputTransport.broadcastBytes(
          managed,
          bytes.subarray(offset, offset + MAX_OUTPUT_BYTES),
        );
      }
    }
    this.maybePauseAfterFlush(managed);
  }

  private maybePauseAfterFlush(managed: ManagedSession): void {
    if (managed.session.isPaused) return;
    for (const client of managed.clients) {
      if (client.pending) continue;
      if (this.clientBacklogBytes(client) >= WS_OUTBOUND_PAUSE_HIGH_WATER_BYTES) {
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
        if (this.clientBacklogBytes(client) > WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
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

  private clientBacklogBytes(client: ManagedClient): number {
    return getBufferedAmount(client.ws) + (client.brotliEncoder?.queuedBytes() ?? 0);
  }

  stopDrainPoll(managed: ManagedSession): void {
    if (managed.drainPollTimer === null) return;
    clearInterval(managed.drainPollTimer);
    managed.drainPollTimer = null;
  }
}
