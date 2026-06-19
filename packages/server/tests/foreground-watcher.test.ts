import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { FOREGROUND_POLL_INTERVAL_MS } from "../src/constants.js";
import { ForegroundWatcher } from "../src/foreground-watcher.js";

// Drives the watcher under fake timers so the poll + dedup are asserted
// deterministically, with no real PTY or process-group introspection in the
// loop (the source of the old flaky integration test).
describe("ForegroundWatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const createWatcher = (
    emitted: Array<string | null>,
    alive: { value: boolean },
    reading: { value: string | null },
  ): ForegroundWatcher =>
    new ForegroundWatcher(
      () => reading.value,
      (process) => emitted.push(process),
      () => alive.value,
    );

  it("emits a foreground event only when the process name genuinely changes", () => {
    vi.useFakeTimers();
    const emitted: Array<string | null> = [];
    const alive = { value: true };
    const reading = { value: null as string | null };
    const watcher = createWatcher(emitted, alive, reading);
    watcher.start();

    reading.value = null;
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    reading.value = "vim";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    reading.value = "vim";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    reading.value = null;
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);

    expect(emitted).toEqual(["vim", null]);
    watcher.dispose();
  });

  it("suppresses the spurious initial emission when the first poll matches null", () => {
    vi.useFakeTimers();
    const emitted: Array<string | null> = [];
    const alive = { value: true };
    const reading = { value: null as string | null };
    const watcher = createWatcher(emitted, alive, reading);
    watcher.start();
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);

    expect(emitted).toEqual([]);
    watcher.dispose();
  });

  it("set() forces an immediate deduped change emission between polls", () => {
    vi.useFakeTimers();
    const emitted: Array<string | null> = [];
    const alive = { value: true };
    const reading = { value: null as string | null };
    const watcher = createWatcher(emitted, alive, reading);
    watcher.start();

    watcher.set(null);
    watcher.set("vim");
    watcher.set("vim");
    watcher.set(null);

    expect(emitted).toEqual(["vim", null]);
    watcher.dispose();
  });

  it("self-disposes once isAlive() reports false and stops further polling", () => {
    vi.useFakeTimers();
    const emitted: Array<string | null> = [];
    const alive = { value: true };
    const reading = { value: null as string | null };
    const watcher = createWatcher(emitted, alive, reading);
    watcher.start();

    reading.value = "vim";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    alive.value = false;
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    reading.value = "htop";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS * 3);

    expect(emitted).toEqual(["vim"]);
  });

  it("stops emitting after dispose()", () => {
    vi.useFakeTimers();
    const emitted: Array<string | null> = [];
    const alive = { value: true };
    const reading = { value: null as string | null };
    const watcher = createWatcher(emitted, alive, reading);
    watcher.start();

    reading.value = "vim";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS);
    watcher.dispose();
    reading.value = "htop";
    vi.advanceTimersByTime(FOREGROUND_POLL_INTERVAL_MS * 3);

    expect(emitted).toEqual(["vim"]);
  });
});
