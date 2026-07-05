import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WebhookTriggerManager } from "../src/webhook-trigger-manager.js";
import type { Automation } from "../src/types.js";

const DEBOUNCE_MS = 50;

const makeAutomation = (overrides: Partial<Automation> = {}): Automation => ({
  id: "h1",
  name: "on webhook",
  trigger: { kind: "webhook", id: "abc123" },
  cwd: "/virtual/h1",
  runner: { kind: "shell", command: "true" },
  enabled: true,
  limit: { kind: "forever" },
  closeOnFinish: false,
  requestedSecrets: [],
  runCount: 0,
  lifecycle: "active",
  runs: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe("WebhookTriggerManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Live-state lookups read mutable holders so a test can flip enabled /
  // in-flight after the POST is accepted.
  const setup = (initial: Automation) => {
    const state = { current: initial as Automation | null, inFlight: false };
    const due: Automation[] = [];
    const manager = new WebhookTriggerManager({
      debounceMs: DEBOUNCE_MS,
      isRunInFlight: () => state.inFlight,
      getAutomation: () => state.current,
    });
    manager.on("due", (automation) => due.push(automation));
    return { manager, due, state };
  };

  it("emits a single due only after the debounce window elapses", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.trigger(automation);
    expect(due).toHaveLength(0);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toEqual([automation]);
    manager.dispose();
  });

  it("coalesces a burst of POSTs into one due", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.trigger(automation);
    manager.trigger(automation);
    manager.trigger(automation);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toEqual([automation]);
    manager.dispose();
  });

  it("resets the debounce window on each POST", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.trigger(automation);
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    manager.trigger(automation);
    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(due).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(due).toEqual([automation]);
    manager.dispose();
  });

  it("drops a POST that arrives while a run is in flight", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    state.inFlight = true;
    manager.trigger(automation);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("re-reads live state at fire time and skips a disabled automation", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    manager.trigger(automation);
    state.current = { ...automation, enabled: false };
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("re-reads live state at fire time and skips a finished automation", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    manager.trigger(automation);
    state.current = { ...automation, lifecycle: "finished" };
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("does not emit after dispose", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.trigger(automation);
    manager.dispose();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
  });

  it("fires a second, independent automation without interference", () => {
    const first = makeAutomation({ id: "h1", trigger: { kind: "webhook", id: "a" } });
    const second = makeAutomation({ id: "h2", trigger: { kind: "webhook", id: "b" } });
    const state = {
      currentById: new Map<string, Automation>([
        ["h1", first],
        ["h2", second],
      ]),
    };
    const due: Automation[] = [];
    const manager = new WebhookTriggerManager({
      debounceMs: DEBOUNCE_MS,
      isRunInFlight: () => false,
      getAutomation: (id) => state.currentById.get(id) ?? null,
    });
    manager.on("due", (automation) => due.push(automation));
    manager.trigger(first);
    manager.trigger(second);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toEqual([first, second]);
    manager.dispose();
  });
});
