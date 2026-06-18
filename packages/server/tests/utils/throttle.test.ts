import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Throttle } from "../../src/utils/throttle.js";

const INTERVAL_MS = 100;

describe("Throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the callback immediately on the leading edge", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger();
    expect(calls).toBe(1);
  });

  it("flushes a single trailing call after a burst within the interval", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger(); // leading
    throttle.trigger(); // coalesced
    throttle.trigger(); // coalesced
    expect(calls).toBe(1);

    vi.advanceTimersByTime(INTERVAL_MS); // trailing flush fires once
    expect(calls).toBe(2);

    // The trailing flush opened a fresh window; no more pending triggers
    // means a second quiet interval must NOT emit again.
    vi.advanceTimersByTime(INTERVAL_MS);
    expect(calls).toBe(2);
  });

  it("does not emit a trailing call when no burst followed the leading edge", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger();
    expect(calls).toBe(1);

    vi.advanceTimersByTime(INTERVAL_MS); // interval elapses, nothing was pending
    expect(calls).toBe(1);
  });

  it("keeps emitting once per interval while triggers continue across windows", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger();
    expect(calls).toBe(1);

    vi.advanceTimersByTime(INTERVAL_MS - 1);
    throttle.trigger(); // pending
    expect(calls).toBe(1);

    vi.advanceTimersByTime(1); // window ends → trailing flush
    expect(calls).toBe(2);

    vi.advanceTimersByTime(INTERVAL_MS - 1);
    throttle.trigger(); // pending in the window the flush opened
    expect(calls).toBe(2);

    vi.advanceTimersByTime(1);
    expect(calls).toBe(3);
  });

  it("starts a fresh leading edge immediately after a quiet period", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger(); // leading
    vi.advanceTimersByTime(INTERVAL_MS + 1); // fully quiet past the window

    throttle.trigger(); // new burst → leading edge again, not throttled
    expect(calls).toBe(2);
  });

  it("reset() cancels a pending trailing flush", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger(); // leading
    throttle.trigger(); // pending trailing
    throttle.reset();

    vi.advanceTimersByTime(INTERVAL_MS * 10);
    expect(calls).toBe(1);
  });

  it("dispose() suppresses further triggers and flushes", () => {
    let calls = 0;
    const throttle = new Throttle(() => {
      calls += 1;
    }, INTERVAL_MS);

    throttle.trigger(); // leading
    throttle.trigger(); // pending trailing
    throttle.dispose();

    vi.advanceTimersByTime(INTERVAL_MS * 10);
    throttle.trigger(); // disposed: no-op
    expect(calls).toBe(1);
  });
});
