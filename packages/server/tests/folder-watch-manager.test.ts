import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { FolderWatchManager } from "../src/folder-watch-manager.js";
import type { Automation } from "../src/types.js";

const DEBOUNCE_MS = 50;

// A fake watch factory: records the listener armed for each target so a test can
// fire synthetic filesystem events, and tracks close(). With fake timers this
// makes every behavior deterministic — no real fs or wall-clock timing.
const makeFakeWatch = () => {
  const armed = new Map<string, { listener: () => void }>();
  const watch = (
    target: string,
    _options: { recursive: boolean },
    listener: () => void,
  ): { close: () => void } => {
    const record = { listener };
    armed.set(target, record);
    return {
      close: () => {
        if (armed.get(target) === record) armed.delete(target);
      },
    };
  };
  return { watch, armed, fire: (target: string) => armed.get(target)?.listener() };
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
    const { manager, armed } = setup(automation);
    manager.sync([automation]);
    const first = armed.get("/virtual/w1");

    const changed = makeAutomation({ trigger: { kind: "watch", recursive: false } });
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
});
