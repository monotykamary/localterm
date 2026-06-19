import { FOREGROUND_POLL_INTERVAL_MS } from "./constants.js";

export interface ForegroundWatcherOptions {
  pollIntervalMs?: number;
}

// Polls a foreground-process source on a fixed interval, deduping consecutive
// equal values so the emitter only sees genuine changes. Extracted from
// Session so the poll + dedup are driven deterministically under fake timers
// in tests, instead of racing a real shell's process-group introspection
// (pty.process reads a transient process name during spawn and is
// load-sensitive — asserting on its settling timing flakes under suite load).
export class ForegroundWatcher {
  private readonly getProcessName: () => string | null;
  private readonly emit: (process: string | null) => void;
  private readonly isAlive: () => boolean;
  private readonly pollIntervalMs: number;
  private lastEmitted: string | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    getProcessName: () => string | null,
    emit: (process: string | null) => void,
    isAlive: () => boolean,
    options?: ForegroundWatcherOptions,
  ) {
    this.getProcessName = getProcessName;
    this.emit = emit;
    this.isAlive = isAlive;
    this.pollIntervalMs = options?.pollIntervalMs ?? FOREGROUND_POLL_INTERVAL_MS;
  }

  start(): void {
    this.lastEmitted = null;
    this.timer = setInterval(() => this.tick(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  // Force an immediate foreground value, deduped against the last emitted one.
  // Used on the alt-screen-off stream signal, which can arrive between polls.
  set(next: string | null): void {
    this.emitIfChanged(next);
  }

  dispose(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    if (!this.isAlive()) {
      this.dispose();
      return;
    }
    this.emitIfChanged(this.getProcessName());
  }

  private emitIfChanged(next: string | null): void {
    if (next === this.lastEmitted) return;
    this.lastEmitted = next;
    this.emit(next);
  }
}
