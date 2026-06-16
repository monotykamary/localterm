import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SessionEventManager } from "../src/session-event-manager.js";
import type { Automation } from "../src/types.js";

const DEBOUNCE_MS = 50;
const POST_RUN_GRACE_MS = 200;

const makeAutomation = (overrides: Partial<Automation> = {}): Automation => ({
  id: "e1",
  name: "on event",
  trigger: { kind: "event", events: ["git-commit"] },
  cwd: "/virtual/e1",
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

describe("SessionEventManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (initial: Automation) => {
    const state = { current: initial as Automation | null, inFlight: false };
    const due: Automation[] = [];
    const manager = new SessionEventManager({
      debounceMs: DEBOUNCE_MS,
      postRunGraceMs: POST_RUN_GRACE_MS,
      isRunInFlight: () => state.inFlight,
      getAutomation: () => state.current,
    });
    manager.on("due", (automation) => due.push(automation));
    return { manager, due, state };
  };

  it("emits a single due only after the debounce window elapses", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);
    manager.onSessionEvent("git-commit", "/virtual/e1");
    expect(due).toHaveLength(0);
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toEqual([automation]);
    manager.dispose();
  });

  it("coalesces a burst of events into one due", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);
    manager.onSessionEvent("git-commit", "/virtual/e1");
    manager.onSessionEvent("git-commit", "/virtual/e1");
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("ignores events that don't match any trigger event name", () => {
    const automation = makeAutomation({ trigger: { kind: "event", events: ["git-commit"] } });
    const { manager, due } = setup(automation);
    manager.sync([automation]);
    manager.onSessionEvent("cwd", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("ignores events from sessions in a different directory", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);
    manager.onSessionEvent("git-commit", "/different/path");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("fires for sessions in a subdirectory of the automation cwd", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);
    manager.onSessionEvent("git-commit", "/virtual/e1/subproject");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("suppresses a launch while a run is in-flight, then resumes", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    state.inFlight = true;
    manager.sync([automation]);
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);

    state.inFlight = false;
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });

  it("re-reads live state and skips a now-disabled automation at fire time", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    manager.sync([automation]);
    state.current = { ...automation, enabled: false };
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("tears the listener down once the automation leaves the desired set", () => {
    const automation = makeAutomation();
    const { manager, due, state } = setup(automation);
    manager.sync([automation]);

    const disabled = { ...automation, enabled: false };
    state.current = disabled;
    manager.sync([disabled]);

    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("never arms a listener for a schedule trigger", () => {
    const scheduled = makeAutomation({
      trigger: { kind: "schedule", schedule: { kind: "everyNMinutes", step: 1 } },
    });
    const { manager, due } = setup(scheduled);
    manager.sync([scheduled]);
    manager.onSessionEvent("git-dirty", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("never arms a listener for a watch trigger", () => {
    const watch = makeAutomation({ trigger: { kind: "watch", recursive: true } });
    const { manager, due } = setup(watch);
    manager.sync([watch]);
    manager.onSessionEvent("git-dirty", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);
    manager.dispose();
  });

  it("rebuilds the listener when the event set changes", () => {
    const automation = makeAutomation({ trigger: { kind: "event", events: ["git-commit"] } });
    const { manager, due, state } = setup(automation);
    manager.sync([automation]);

    // Fires for git-commit.
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    // Switch the trigger events.
    const changed = makeAutomation({ trigger: { kind: "event", events: ["cwd"] } });
    state.current = changed;
    manager.sync([changed]);

    // git-commit no longer matches.
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    // cwd now matches.
    manager.onSessionEvent("cwd", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(2);
    manager.dispose();
  });

  it("fires when any selected event matches", () => {
    const automation = makeAutomation({
      trigger: { kind: "event", events: ["git-commit", "git-merge"] },
    });
    const { manager, due } = setup(automation);
    manager.sync([automation]);

    manager.onSessionEvent("git-merge", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    manager.dispose();
  });

  it("supports each event type", () => {
    const eventNames = [
      "git-commit",
      "git-checkout",
      "git-reset",
      "notification",
      "cwd",
      "foreground",
      "exit",
    ] as const;
    for (const eventName of eventNames) {
      const due: Automation[] = [];
      const automation = makeAutomation({ trigger: { kind: "event", events: [eventName] } });
      const state = { current: automation as Automation | null, inFlight: false };
      const manager = new SessionEventManager({
        debounceMs: DEBOUNCE_MS,
        postRunGraceMs: POST_RUN_GRACE_MS,
        isRunInFlight: () => state.inFlight,
        getAutomation: () => state.current,
      });
      manager.on("due", (a) => due.push(a));
      manager.sync([automation]);

      manager.onSessionEvent(eventName, "/virtual/e1");
      vi.advanceTimersByTime(DEBOUNCE_MS);
      expect(due).toHaveLength(1);

      manager.dispose();
    }
  });

  it("drops events during the post-run grace window", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);

    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    manager.notifyRunFinished("e1");

    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);

    vi.advanceTimersByTime(POST_RUN_GRACE_MS);
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(2);
    manager.dispose();
  });

  it("resets the grace window if notifyRunFinished is called again", () => {
    const automation = makeAutomation();
    const { manager, due } = setup(automation);
    manager.sync([automation]);

    manager.notifyRunFinished("e1");
    vi.advanceTimersByTime(POST_RUN_GRACE_MS - 10);
    manager.notifyRunFinished("e1");
    vi.advanceTimersByTime(POST_RUN_GRACE_MS - 10);

    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(0);

    vi.advanceTimersByTime(20);
    manager.onSessionEvent("git-commit", "/virtual/e1");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(due).toHaveLength(1);
    manager.dispose();
  });
});
