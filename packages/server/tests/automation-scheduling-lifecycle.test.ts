import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationDispatcher } from "../src/automation-dispatcher.js";
import { AutomationScheduler } from "../src/automation-scheduler.js";
import { AutomationStore } from "../src/automation-store.js";
import { createAutomationInputSchema } from "../src/schemas.js";
import type { AutomationRunRecord, CreateAutomationInput } from "../src/types.js";

const base = Date.UTC(2026, 0, 1, 8);
let directory: string;
let store: AutomationStore;
let scheduler: AutomationScheduler;
let dispatcher: AutomationDispatcher;
let launched: AutomationRunRecord[];
const create = (patch: Partial<CreateAutomationInput> = {}) =>
  store.create(
    createAutomationInputSchema.parse({
      name: "Morning report",
      cwd: os.tmpdir(),
      timezone: "UTC",
      runner: { kind: "shell", command: "true" },
      trigger: { kind: "schedule", schedule: { kind: "daily", hour: 9, minute: 0 } },
      ...patch,
    }),
  );
const connect = () => {
  scheduler = new AutomationScheduler(store);
  dispatcher = new AutomationDispatcher({
    store,
    changed: () => {},
    launch: (_automation, run) => {
      launched.push(run);
    },
  });
  scheduler.on("due", (automation, scheduledFor) =>
    dispatcher.request(automation.id, "schedule", scheduledFor),
  );
  scheduler.on("skipped", (automation, scheduledFor) =>
    dispatcher.request(automation.id, "schedule", scheduledFor, "downtime"),
  );
};
const tick = (at: number) => {
  vi.setSystemTime(at);
  scheduler.runTick(new Date(at));
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(base);
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-timing-"));
  store = new AutomationStore(path.join(directory, "automations.json"));
  launched = [];
  connect();
});
afterEach(() => {
  scheduler.dispose();
  dispatcher.dispose();
  vi.restoreAllMocks();
  vi.useRealTimers();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("automation scheduling lifecycle", () => {
  it.each(["skip", "run-latest"] as const)("applies %s after a live daemon sleep gap", (policy) => {
    const automation = create({ missedRunPolicy: policy });
    tick(base);
    tick(base + 2 * 60 * 60_000);
    expect(launched).toHaveLength(policy === "skip" ? 0 : 1);
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      scheduledFor: base + 60 * 60_000,
      status: policy === "skip" ? "skipped" : "launched",
      ...(policy === "skip" ? { reason: "downtime" } : {}),
    });
    tick(base + 2 * 60 * 60_000 + 20_000);
    expect(store.get(automation.id)?.runs).toHaveLength(1);
  });

  it("collapses a long outage into one latest run rather than replaying a backlog", () => {
    const automation = create({
      missedRunPolicy: "run-latest",
      trigger: { kind: "schedule", schedule: { kind: "everyNMinutes", step: 1 } },
    });
    tick(base);
    tick(base + 3 * 60 * 60_000 + 10_000);
    expect(launched).toHaveLength(1);
    expect(launched[0].scheduledFor).toBe(base + 3 * 60 * 60_000);
    expect(store.get(automation.id)?.runCount).toBe(1);
    expect(store.get(automation.id)?.runs.filter((run) => run.status === "skipped")).toHaveLength(
      9,
    );
  });

  it("still runs the current occurrence when missed work is set to skip", () => {
    const automation = create({
      trigger: { kind: "schedule", schedule: { kind: "everyNMinutes", step: 2 } },
    });
    tick(base);
    tick(base + 6 * 60_000 + 10_000);
    expect(launched.map((run) => run.scheduledFor)).toEqual([base + 6 * 60_000]);
    expect(
      store
        .get(automation.id)
        ?.runs.filter((run) => run.status === "skipped")
        .map((run) => run.scheduledFor),
    ).toEqual([base + 4 * 60_000, base + 2 * 60_000]);
  });

  it("uses persisted occurrence identity after a same-minute daemon restart", () => {
    const automation = create();
    tick(base + 60 * 60_000);
    expect(launched).toHaveLength(1);
    scheduler.dispose();
    dispatcher.dispose();
    store = new AutomationStore(path.join(directory, "automations.json"));
    connect();
    dispatcher.recover();
    scheduler.start(base + 60 * 60_000 - 30_000);
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runs[0].status).toBe("interrupted");
  });

  it("does not reconstruct occurrences before an automation was created", () => {
    const automation = create();
    vi.setSystemTime(base + 30 * 60_000);
    scheduler.start(base - 2 * 24 * 60 * 60_000);
    expect(store.get(automation.id)?.runs).toEqual([]);
  });

  it("arms exact interval anchors, not just minute boundaries", () => {
    create({
      trigger: {
        kind: "schedule",
        schedule: { kind: "interval", every: 40, unit: "minutes", anchorAt: base + 30_000 },
      },
    });
    scheduler.start();
    vi.advanceTimersByTime(30_100);
    expect(launched.map((run) => run.scheduledFor)).toEqual([base + 30_000]);
  });

  it("retries an uncommitted window instead of advancing the heartbeat on write failure", () => {
    const automation = create({ missedRunPolicy: "run-latest" });
    const faults = vi.fn();
    const heartbeat = vi.fn();
    scheduler.on("fault", faults);
    scheduler.on("tick", (_now, healthy) => heartbeat(healthy));
    tick(base);
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    tick(base + 2 * 60 * 60_000);
    expect(faults).toHaveBeenCalledOnce();
    expect(heartbeat).toHaveBeenLastCalledWith(false);
    expect(launched).toHaveLength(0);
    tick(base + 2 * 60 * 60_000);
    expect(heartbeat).toHaveBeenLastCalledWith(true);
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runs).toHaveLength(1);
  });

  it("preserves an existing clock-aligned step when migrating v4 state", () => {
    const automation = create({
      trigger: { kind: "schedule", schedule: { kind: "everyNMinutes", step: 40 } },
    });
    fs.writeFileSync(
      path.join(directory, "automations.json"),
      JSON.stringify({
        version: 4,
        automations: [
          {
            ...automation,
            timezone: undefined,
            concurrencyPolicy: undefined,
            missedRunPolicy: undefined,
          },
        ],
      }),
    );
    const migrated = new AutomationStore(path.join(directory, "automations.json")).get(
      automation.id,
    );
    expect(migrated?.trigger).toEqual(automation.trigger);
    expect(migrated?.timezone).toBeUndefined();
    expect(migrated?.lastScheduledAt).toBeUndefined();
  });
});
