import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FILE_WATCH_RETRY_INITIAL_MS, FILE_WATCH_RETRY_MAX_MS } from "../../src/constants.js";
import { watchWithRecovery } from "../../src/utils/watch-with-recovery.js";

const handle = () => Object.assign(new EventEmitter(), { close: vi.fn(), unref: vi.fn() });

describe("watchWithRecovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("contains late errors, replaces the handle, and ignores stale callbacks", async () => {
    const handles = [handle(), handle()];
    const callbacks: Array<(event: string, filename: string | null) => void> = [];
    const factory = vi.fn((_target, _options, callback) => {
      callbacks.push(callback);
      return handles[callbacks.length - 1];
    });
    const listener = vi.fn();
    const subscription = watchWithRecovery("/virtual", { recursive: true }, listener, factory);
    expect(() => handles[0].emit("error", new Error("ENOSPC"))).not.toThrow();
    expect(handles[0].close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_INITIAL_MS);
    expect(factory).toHaveBeenCalledTimes(2);
    callbacks[0]("change", "stale");
    callbacks[1]("change", "fresh");
    expect(listener).toHaveBeenCalledExactlyOnceWith("change", "fresh");
    subscription.close();
    expect(handles[1].close).toHaveBeenCalledOnce();
    expect(() => handles[1].emit("error", new Error("late close error"))).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds retries after synchronous failures and cancels them on close", async () => {
    const factory = vi.fn(() => {
      throw new Error("EMFILE");
    });
    const subscription = watchWithRecovery("/virtual", { recursive: true }, vi.fn(), factory);
    let delay = FILE_WATCH_RETRY_INITIAL_MS;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = factory.mock.calls.length;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(factory).toHaveBeenCalledTimes(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(factory).toHaveBeenCalledTimes(before + 1);
      delay = Math.min(delay * 2, FILE_WATCH_RETRY_MAX_MS);
    }
    expect(console.warn).toHaveBeenCalledOnce();
    subscription.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not allocate replacements while asynchronous close is pending", async () => {
    const closing = Promise.withResolvers<void>();
    const native = handle();
    native.close.mockReturnValue(closing.promise);
    const factory = vi.fn(() => native);
    const subscription = watchWithRecovery("/virtual", { recursive: false }, vi.fn(), factory);
    native.emit("error", new Error("ENOSPC"));
    await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_MAX_MS);
    expect(factory).toHaveBeenCalledOnce();
    subscription.close();
    closing.resolve();
    await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_MAX_MS);
    expect(factory).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("contains rejected close promises and still recovers", async () => {
    const first = handle();
    const second = handle();
    first.close.mockRejectedValue(new Error("close failed"));
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    const subscription = watchWithRecovery("/virtual", { recursive: false }, vi.fn(), factory);
    first.emit("error", new Error("EIO"));
    await vi.advanceTimersByTimeAsync(FILE_WATCH_RETRY_INITIAL_MS);
    expect(factory).toHaveBeenCalledTimes(2);
    subscription.close();
  });
});
