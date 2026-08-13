import fs from "node:fs";
import nodeFs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  MAX_AUTOMATION_LOG_LENGTH,
  MAX_OUTPUT_BYTES,
  OUTPUT_BATCH_FLUSH_BYTES,
  OUTPUT_BATCH_WINDOW_MS,
  OUTPUT_STREAM_THRESHOLD_MS,
  OUTPUT_SYNCHRONIZED_FRAME_TIMEOUT_MS,
  RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES,
  RENDERER_PENDING_RESUME_LOW_WATER_BYTES,
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
  // Sessions that have relayed at least one pixel frame since spawn — used to
  // scope screen-reset clears to apps that actually own an on-screen picture.
  private readonly frameSessions = new WeakSet<ManagedSession>();

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

  private maybeAnswerProbe(managed: ManagedSession, probe: KittyMediumProbe): Promise<void> | null {
    if (!this.canRelayFrames(managed)) return null;
    return this.respondToProbe(managed, probe);
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

  async onSessionOutput(managed: ManagedSession, data: string): Promise<void> {
    // kitty file-medium sequences: probes are answered by the daemon (and
    // stripped so nothing else races a reply); named frame transmits pass
    // through while their pixels are relayed over the WS frame channel.
    const scan = this.scannerFor(managed).push(data);
    const probeTasks = scan.probes
      .map((probe) => this.maybeAnswerProbe(managed, probe))
      .filter((task) => task !== null);
    const frameTasks = scan.frames.map((frame) =>
      this.frameRelay.push(managed, frame, this.tmpdirRoot),
    );
    const asyncTasks = Promise.all([...probeTasks, ...frameTasks]);
    if (scan.frames.length > 0) this.frameSessions.add(managed);
    if (scan.screenReset && this.frameSessions.delete(managed)) {
      // The frame-relaying app left the alt screen (or hard-reset): the main
      // buffer content is back on screen, so any relayed picture still covering
      // it on a client must be dropped. No-op if the session never framed. The
      // relay is cancelled first so a read in flight can't re-land a stale
      // frame after the clear.
      this.frameRelay.cancel(managed);
      this.outputTransport.broadcast(managed, { type: "pixel-frames-clear" });
    }
    const output = scan.output;
    const outputAtMs = Date.now();
    const didEndSynchronizedOutput = managed.synchronizedOutputEndDetector.push(output);
    if (output.length > 0 && managed.outputBurstStartedAtMs === null) {
      managed.outputBurstStartedAtMs = outputAtMs;
    }
    managed.outputBatch += output;
    managed.lastOutputAt = outputAtMs;
    if (managed.automation) this.appendAutomationLog(managed, output);
    this.noteOutputActivity(managed.session.pid);
    this.onOutputActivity();
    // Keep rendered terminal models in lockstep with the bytes clients see.
    managed.captureRenderer?.write(output);
    managed.hibernateRenderer?.write(output);

    if (output.length === 0) {
      await asyncTasks;
      return;
    }

    if (didEndSynchronizedOutput) {
      this.clearOutputBatchTimer(managed);
      if (!managed.outputBurstIsStream && managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
        this.openAtomicOutputFrame(managed);
      }
      this.flushOutput(managed);
      this.closeAtomicOutputFrame(managed);
      this.resetOutputBurst(managed);
      await asyncTasks;
      return;
    }

    // Small bursts still flush as one message on the resetting idle timer. Once
    // a redraw crosses 64 KiB, bracket every size-capped message so a capable
    // browser retains the old complete screen until the idle boundary and then
    // commits the new screen in one xterm write. After 100 ms without idling,
    // unsynchronized output is a stream and returns to progressive delivery.
    // DEC 2026 remains authoritative until DECRST or its safety timeout.
    if (managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
      this.clearOutputBatchTimer(managed);
      const outputBurstStartedAtMs = managed.outputBurstStartedAtMs ?? outputAtMs;
      const outputBurstDurationMs = outputAtMs - outputBurstStartedAtMs;
      if (
        !managed.outputBurstIsStream &&
        !managed.synchronizedOutputEndDetector.isActive() &&
        outputBurstDurationMs >= OUTPUT_STREAM_THRESHOLD_MS
      ) {
        managed.outputBurstIsStream = true;
      }
      if (!managed.outputBurstIsStream) this.openAtomicOutputFrame(managed);
      this.flushOutput(managed);
      if (managed.outputBurstIsStream) this.closeAtomicOutputFrame(managed);
      this.scheduleOutputBatchFlush(managed);
      await asyncTasks;
      return;
    }

    this.scheduleOutputBatchFlush(managed);
    await asyncTasks;
  }

  private clearOutputBatchTimer(managed: ManagedSession): void {
    if (managed.outputBatchTimer === null) return;
    clearTimeout(managed.outputBatchTimer);
    managed.outputBatchTimer = null;
  }

  private scheduleOutputBatchFlush(managed: ManagedSession): void {
    const outputBurstStartedAtMs = managed.outputBurstStartedAtMs;
    if (outputBurstStartedAtMs === null) return;
    this.clearOutputBatchTimer(managed);
    const synchronizedOutputActive =
      managed.synchronizedOutputEndDetector.isActive() && !managed.outputBurstIsStream;
    const timeoutMs = synchronizedOutputActive
      ? Math.max(0, OUTPUT_SYNCHRONIZED_FRAME_TIMEOUT_MS - (Date.now() - outputBurstStartedAtMs))
      : OUTPUT_BATCH_WINDOW_MS;
    managed.outputBatchTimer = setTimeout(() => {
      managed.outputBatchTimer = null;
      this.flushOutput(managed);
      this.closeAtomicOutputFrame(managed);
      if (managed.synchronizedOutputEndDetector.isActive()) {
        managed.outputBurstIsStream = true;
      } else {
        this.resetOutputBurst(managed);
      }
    }, timeoutMs);
    managed.outputBatchTimer.unref?.();
  }

  private openAtomicOutputFrame(managed: ManagedSession): void {
    if (managed.atomicOutputFrameOpen) return;
    managed.atomicOutputFrameOpen = true;
    this.outputTransport.broadcastAtomicOutputFrameBoundary(managed, "output-frame-start");
  }

  private closeAtomicOutputFrame(managed: ManagedSession): void {
    if (!managed.atomicOutputFrameOpen) return;
    this.outputTransport.broadcastAtomicOutputFrameBoundary(managed, "output-frame-end");
    managed.atomicOutputFrameOpen = false;
  }

  private resetOutputBurst(managed: ManagedSession): void {
    managed.outputBurstStartedAtMs = null;
    managed.outputBurstIsStream = false;
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

  finishOutputBurst(managed: ManagedSession): void {
    this.clearOutputBatchTimer(managed);
    if (!managed.outputBurstIsStream && managed.outputBatch.length >= OUTPUT_BATCH_FLUSH_BYTES) {
      this.openAtomicOutputFrame(managed);
    }
    this.flushOutput(managed);
    this.closeAtomicOutputFrame(managed);
    this.resetOutputBurst(managed);
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
    if (this.rendererBacklogBytes(managed) >= RENDERER_PENDING_PAUSE_HIGH_WATER_BYTES) {
      managed.session.pause();
      this.ensureDrainPoll(managed);
      return;
    }
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
      let allLow = this.rendererBacklogBytes(managed) <= RENDERER_PENDING_RESUME_LOW_WATER_BYTES;
      if (allLow) {
        for (const client of managed.clients) {
          if (client.pending) continue;
          if (this.clientBacklogBytes(client) > WS_OUTBOUND_RESUME_LOW_WATER_BYTES) {
            allLow = false;
            break;
          }
        }
      }
      if (allLow) {
        managed.session.resume();
        this.stopDrainPoll(managed);
      }
    }, WS_OUTBOUND_DRAIN_POLL_MS);
    managed.drainPollTimer.unref?.();
  }

  private rendererBacklogBytes(managed: ManagedSession): number {
    return Math.max(
      managed.captureRenderer?.queuedBytes ?? 0,
      managed.hibernateRenderer?.queuedBytes ?? 0,
    );
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
