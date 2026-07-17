import { randomBytes } from "node:crypto";
import { CaptureRenderer } from "./capture-renderer.js";
import {
  EXEC_DEFAULT_OUTPUT_LIMIT_BYTES,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_EPHEMERAL_SCROLLBACK,
  EXEC_MAX_OUTPUT_LIMIT_BYTES,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_RAW_ACCUMULATE_CAP_BYTES,
  EXEC_TIMEOUT_INTERRUPT_GRACE_MS,
  CAPTURE_PANE_MAX_LINES,
  WAIT_IDLE_POLL_INTERVAL_MS,
} from "./constants.js";
import type {
  ExecOptions,
  ExecResult,
  ManagedSession,
  WaitPredicate,
  WaitResult,
} from "./session-manager.js";

export class SessionCommandExecutor {
  async capturePane(managed: ManagedSession, lines?: number): Promise<string> {
    const capped = lines && lines > 0 ? Math.min(lines, CAPTURE_PANE_MAX_LINES) : undefined;
    const renderer = await this.ensureCaptureRenderer(managed);
    return renderer.capture(capped);
  }

  async waitFor(
    managed: ManagedSession,
    predicate: WaitPredicate,
    timeoutMs: number,
    idleMs?: number,
  ): Promise<WaitResult> {
    const session = managed.session;
    const startedAt = Date.now();
    let resolved = false;
    let lastChangeAt = Date.now();
    let timeoutHandle: NodeJS.Timeout | null = null;
    let idleTimer: NodeJS.Timeout | null = null;
    return new Promise<WaitResult>((resolve) => {
      const finalize = async (matched: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (idleTimer) clearInterval(idleTimer);
        session.off("output", onOutput);
        session.off("exit", onExit);
        const snapshot = await this.capturePane(managed).catch(() => "");
        resolve({
          matched,
          elapsedMs: Date.now() - startedAt,
          snapshot,
        });
      };
      const testPredicate = async (): Promise<boolean> => {
        const renderer = await this.ensureCaptureRenderer(managed);
        await renderer.flush();
        return predicate.test(renderer.capture());
      };
      const onOutput = (): void => {
        lastChangeAt = Date.now();
        void testPredicate().then((hit) => {
          if (hit && !resolved) finalize(true);
        });
      };
      const onExit = (): void => {
        void finalize(false);
      };
      // Idle mode: resolve once no output has arrived for `idleMs`. The interval
      // checks recency without forcing a renderer read each tick (the output
      // listener already bumps lastChangeAt).
      if (predicate.kind === "idle") {
        idleTimer = setInterval(() => {
          if (!resolved && Date.now() - lastChangeAt >= (idleMs ?? 0)) finalize(true);
        }, WAIT_IDLE_POLL_INTERVAL_MS);
        idleTimer.unref?.();
      } else {
        // Text/regex: test once up front in case the pane already matches, then
        // react to output events.
        void testPredicate().then((hit) => {
          if (hit && !resolved) finalize(true);
        });
      }
      session.on("output", onOutput);
      session.on("exit", onExit);
      timeoutHandle = setTimeout(() => finalize(false), timeoutMs);
      timeoutHandle.unref?.();
    });
  }

  async findTextInViewport(
    managed: ManagedSession,
    needle: string,
  ): Promise<{ col: number; row: number } | null> {
    const renderer = await this.ensureCaptureRenderer(managed);
    await renderer.flush();
    return renderer.findTextInViewport(needle);
  }

  // Lazily create (and prime) a session's capture renderer. Fed the scrollback
  // snapshot at creation so it catches up on recent history before the renderer
  // existed, then kept alive and fed live output by onSessionOutput. Awaits the
  // snapshot's async parse so the first capture-pane read lands on a populated
  // grid instead of a blank one (xterm parses `write` on a timer).
  private async ensureCaptureRenderer(managed: ManagedSession): Promise<CaptureRenderer> {
    if (managed.captureRenderer) return managed.captureRenderer;
    const renderer = new CaptureRenderer(managed.session.cols, managed.session.rows);
    const snapshot = managed.session.snapshotScrollback();
    if (snapshot) renderer.write(snapshot);
    await renderer.flush();
    managed.captureRenderer = renderer;
    return renderer;
  }

  async execute(
    managed: ManagedSession,
    command: string,
    options: ExecOptions = {},
  ): Promise<ExecResult> {
    const session = managed.session;

    const timeoutMs = this.clampInt(
      options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS,
      1,
      EXEC_MAX_TIMEOUT_MS,
    );
    const outputLimit = this.clampInt(
      options.outputLimitBytes ?? EXEC_DEFAULT_OUTPUT_LIMIT_BYTES,
      1,
      EXEC_MAX_OUTPUT_LIMIT_BYTES,
    );

    const token = randomBytes(8).toString("hex");
    const startMarker = `__LT_S_${token}__`;
    const endMarkerPrefix = `__LT_E_${token}__`;
    const endPattern = new RegExp(`${endMarkerPrefix} (\\d+)`);
    const cmd = command.trim() || ":";
    const wrapped = `printf '${startMarker}\\n'; ${cmd}; printf '${endMarkerPrefix} %d\\n' "$?"`;

    const startedAt = Date.now();
    let accumulated = "";
    let capped = false;
    let exitCode: number | null = null;
    let didTimeout = false;
    let resolved = false;
    let timeoutHandle: NodeJS.Timeout | null = null;
    let interruptHandle: NodeJS.Timeout | null = null;

    return new Promise<ExecResult>((resolve) => {
      const finalize = async (finalExit: number | null, finalTimedOut: boolean) => {
        if (resolved) return;
        resolved = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (interruptHandle) clearTimeout(interruptHandle);
        session.off("output", onOutput);
        session.off("exit", onExit);
        resolve(
          await this.buildExecResult(
            session.cols,
            session.rows,
            accumulated,
            startMarker,
            endMarkerPrefix,
            finalExit,
            finalTimedOut,
            outputLimit,
            startedAt,
          ),
        );
      };

      const onOutput = (data: string): void => {
        if (!capped) {
          if (accumulated.length + data.length <= EXEC_RAW_ACCUMULATE_CAP_BYTES) {
            accumulated += data;
          } else {
            const room = EXEC_RAW_ACCUMULATE_CAP_BYTES - accumulated.length;
            if (room > 0) accumulated += data.slice(0, room);
            capped = true;
          }
        }
        // Once the timeout has fired we've committed to a timed-out result; a
        // marker arriving during the interrupt grace (Ctrl-C kills the command,
        // the trailing `printf END $?` runs with the interrupt exit code) is
        // ignored so the call resolves as timed out, not as a normal completion.
        if (didTimeout) return;
        const match = accumulated.match(endPattern);
        if (match) {
          exitCode = Number.parseInt(match[1], 10);
          finalize(exitCode, false);
        }
      };
      const onExit = (code: number | null): void => {
        exitCode = code;
        finalize(code, false);
      };

      session.on("output", onOutput);
      session.on("exit", onExit);

      timeoutHandle = setTimeout(() => {
        // Commit to a timed-out result: the command didn't finish within
        // timeoutMs. Send Ctrl-C to interrupt it (so the session returns to a
        // prompt for a follow-up call), then resolve after a short grace so any
        // output already in flight is captured into the partial result. A marker
        // arriving during the grace is ignored (see onOutput).
        didTimeout = true;
        session.write("\x03");
        interruptHandle = setTimeout(() => finalize(null, true), EXEC_TIMEOUT_INTERRUPT_GRACE_MS);
        interruptHandle.unref?.();
      }, timeoutMs);
      timeoutHandle.unref?.();

      // A client sending input is live; for a detached session there's no
      // pending handshake, so the bytes reach the PTY directly.
      session.write(`${wrapped}\r`);
    });
  }

  private async buildExecResult(
    cols: number,
    rows: number,
    accumulated: string,
    startMarker: string,
    endMarkerPrefix: string,
    exitCode: number | null,
    timedOut: boolean,
    outputLimit: number,
    startedAt: number,
  ): Promise<ExecResult> {
    // Render the captured raw stream through a fresh headless terminal and slice
    // between the start/end marker rows for clean, ANSI-processed text. A fresh
    // (not the persistent) renderer so this exec's output is isolated and the
    // markers are always near the bottom of the buffer.
    const renderer = new CaptureRenderer(cols, rows, EXEC_EPHEMERAL_SCROLLBACK);
    let output: string;
    try {
      renderer.write(accumulated);
      await renderer.flush();
      const endRow =
        exitCode !== null && !timedOut ? renderer.findRow(`${endMarkerPrefix} ${exitCode}`) : -1;
      const startRow = renderer.findRow(startMarker);
      output = renderer.extractBetween(startRow, endRow);
    } finally {
      renderer.dispose();
    }
    const textBytes = Buffer.byteLength(output, "utf8");
    const truncated = textBytes > outputLimit;
    if (truncated) {
      output = Buffer.from(output, "utf8").subarray(0, outputLimit).toString("utf8");
    }
    return {
      exitCode,
      output,
      timedOut,
      truncated,
      durationMs: Date.now() - startedAt,
    };
  }

  private clampInt(value: number, min: number, max: number): number {
    return Math.min(Math.max(Math.trunc(value), min), max);
  }
}
