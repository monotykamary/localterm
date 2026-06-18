// Leading-edge throttle with a trailing flush.
//
// The first `trigger()` after a quiet period runs the callback immediately
// (low latency for the start of a burst). Further `trigger()` calls within the
// interval are coalesced and flushed exactly once when the interval elapses so
// the FINAL state of the burst is always signaled. A leading-edge-only
// throttle would drop that trailing flush and leave consumers reading a
// snapshot taken mid-burst (e.g. a partial write before an atomic rename).
export class Throttle {
  private timer: NodeJS.Timeout | null = null;
  private trailingPending = false;
  private disposed = false;

  constructor(
    private readonly callback: () => void,
    private readonly intervalMs: number,
  ) {}

  trigger(): void {
    if (this.disposed) return;
    if (this.timer !== null) {
      this.trailingPending = true;
      return;
    }
    this.callback();
    this.timer = setTimeout(() => this.flush(), this.intervalMs);
    this.timer.unref?.();
  }

  private flush(): void {
    this.timer = null;
    if (!this.trailingPending) return;
    this.trailingPending = false;
    // Re-enter trigger so a burst that's still ongoing starts a fresh window
    // rather than collapsing to a single trailing flush.
    this.trigger();
  }

  // Cancel any pending trailing flush without running it. Used on stop/restart
  // so a stale callback can't fire into a new state.
  reset(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.trailingPending = false;
  }

  dispose(): void {
    this.disposed = true;
    this.reset();
  }
}
