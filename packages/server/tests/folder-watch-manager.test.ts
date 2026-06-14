import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FolderWatchManager } from "../src/folder-watch-manager.js";
import type { Automation } from "../src/types.js";

const DEBOUNCE_MS = 50;
const POST_RUN_GRACE_MS = 200;

// A fake watch factory: records the listener armed for each target so a test can
// fire synthetic filesystem events, and tracks close(). With fake timers this
// makes every behavior deterministic — no real fs or wall-clock timing.
const makeFakeWatch = () => {
  const armed = new Map<string, { listener: (event: string, filename: string | null) => void }>();
  const watch = (
    target: string,
    _options: { recursive: boolean },
    listener: (event: string, filename: string | null) => void,
  ): { close: () => void } => {
    const record = { listener };
    armed.set(target, record);
    return {
      close: () => {
        if (armed.get(target) === record) armed.delete(target);
      },
    };
  };
  return {
    watch,
    armed,
    fire: (target: string, filename: string | null = null) =>
      armed.get(target)?.listener("change", filename),
  };
};

const makeAutomation = (overrides: Partial<Automation> = {}): Automation => ({
  id: "w1",
  name: "on change",
  trigger: { kind: "watch", recursive: true },
  cwd: "/virtual/w1",
  command: "true",
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("FolderWatchManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Live-state lookups read mutable holders so a test can flip enabled /
  // in-flight after the watch is armed.
  const setup = (initial: Automation) => {
    const state = { current: initial as Automation | null, inFlight: false };
    const due: Automation[] = [];
    const fake = makeFakeWatch();
    const manager = new FolderWatchManager({
      debounceMs: DEBOUNCE_MS,
      postRunGraceMs: POST_RUN_GRACE_MS,
      isRunInFlight: () => state.inFlight,
      getAutomation: () => state.current,
      watch: fake.watch,
    });
    manager.on("due", (automation) => due.push(automation));
    return { manager, due, state, fire: fake.fire, armed: fake.armed };
  };

  it("emits a single due only after the debounce window elapses", () => {
    const automation = makeAutomation();
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);
    fire("/virtual/w1");
    expect(due).toHaveLength(0); // still within the quiet period
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toEqual([automation]);
    manager.dispose();
  });

  it("coalesces a burst of changes into one due", () => {
    const automation = makeAutomation();
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);
    fire("/virtual/w1");
    fire("/virtual/w1");
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("suppresses a launch while a run is in-flight, then resumes", () => {
    const automation = makeAutomation();
    const { manager, due, state, fire } = setup(automation);
    state.inFlight = true;
    manager.sync([automation]);
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0); // dropped — no overlap

    state.inFlight = false;
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("re-reads live state and skips a now-disabled automation at fire time", () => {
    const automation = makeAutomation();
    const { manager, due, state, fire } = setup(automation);
    manager.sync([automation]);
    // Disabled in the store but NOT re-synced: fire() re-reads live state.
    state.current = { ...automation, enabled: false };
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("tears the watcher down once the automation leaves the desired set", () => {
    const automation = makeAutomation();
    const { manager, due, state, fire, armed } = setup(automation);
    manager.sync([automation]);
    expect(armed.has("/virtual/w1")).toBe(true);

    const disabled = { ...automation, enabled: false };
    state.current = disabled;
    manager.sync([disabled]);
    expect(armed.has("/virtual/w1")).toBe(false); // watcher closed

    fire("/virtual/w1"); // no-op: nothing armed
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("rebuilds the watcher when the recursive flag changes", () => {
    const automation = makeAutomation({ trigger: { kind: "watch", recursive: true } });
    const { manager, state, armed } = setup(automation);
    manager.sync([automation]);
    const first = armed.get("/virtual/w1");

    const changed = makeAutomation({ trigger: { kind: "watch", recursive: false } });
    state.current = changed;
    manager.sync([changed]);
    expect(armed.get("/virtual/w1")).not.toBe(first); // re-armed
    manager.dispose();
  });

  it("never arms a watcher for a schedule trigger", () => {
    const scheduled = makeAutomation({
      trigger: { kind: "schedule", schedule: { kind: "everyNMinutes", step: 1 } },
    });
    const { manager, armed } = setup(scheduled);
    manager.sync([scheduled]);
    expect(armed.size).toBe(0);
    manager.dispose();
  });

  it("skips events whose filename does not match the filter", () => {
    const automation = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.mov" },
    });
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    fire("/virtual/w1", "video.mp4");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);

    fire("/virtual/w1", "clip.mov");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("passes events with a null filename through when a filter is set", () => {
    const automation = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.mov" },
    });
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    fire("/virtual/w1", null);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("accepts all events when no filter is set", () => {
    const automation = makeAutomation();
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    fire("/virtual/w1", "anything.txt");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("supports brace expansion in the filter pattern", () => {
    const automation = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.{mov,avi}" },
    });
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    fire("/virtual/w1", "video.mp4");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);

    fire("/virtual/w1", "clip.avi");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("rebuilds the watcher when the filter changes", () => {
    const automation = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.mov" },
    });
    const { manager, state, armed } = setup(automation);
    manager.sync([automation]);
    const first = armed.get("/virtual/w1");

    const changed = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.mp4" },
    });
    state.current = changed;
    manager.sync([changed]);
    expect(armed.get("/virtual/w1")).not.toBe(first);
    manager.dispose();
  });

  it("drops events during the post-run grace window", () => {
    const automation = makeAutomation({
      trigger: { kind: "watch", recursive: true, filter: "*.mov" },
    });
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    // First event fires normally.
    fire("/virtual/w1", "clip.mov");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    // Simulate the run finishing — arms the grace window.
    manager.notifyRunFinished("w1");

    // Side-effect event (e.g. deletion of the .mov) arrives and is dropped.
    fire("/virtual/w1", "clip.mov");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    // After the grace expires, a new event triggers normally.
    vi.advanceTimersByTime(POST_RUN_GRACE_MS);
    fire("/virtual/w1", "new.mov");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(2);
    manager.dispose();
  });

  it("resets the grace window if notifyRunFinished is called again", () => {
    const automation = makeAutomation();
    const { manager, due, fire } = setup(automation);
    manager.sync([automation]);

    manager.notifyRunFinished("w1");
    vi.advanceTimersByTime(POST_RUN_GRACE_MS - 10);
    // A second finish call resets the window.
    manager.notifyRunFinished("w1");
    vi.advanceTimersByTime(POST_RUN_GRACE_MS - 10);
    // Still within the reset grace — event is dropped.
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);

    vi.advanceTimersByTime(20);
    fire("/virtual/w1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });
});
