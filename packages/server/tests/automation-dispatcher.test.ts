import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AutomationDispatcher } from "../src/automation-dispatcher.js";
import { AutomationStore } from "../src/automation-store.js";
import { MAX_AUTOMATION_CONCURRENT_RUNS, AUTOMATION_RUN_HISTORY_CAP } from "../src/constants.js";
import { createAutomationInputSchema } from "../src/schemas.js";
import type { Automation, AutomationRunRecord, CreateAutomationInput } from "../src/types.js";

let directory: string;
let file: string;
let store: AutomationStore;
let dispatcher: AutomationDispatcher;
let now: number;
let launched: Array<{ automation: Automation; run: AutomationRunRecord }>;
const create = (patch: Partial<CreateAutomationInput> = {}) =>
  store.create(
    createAutomationInputSchema.parse({
      name: "Review",
      cwd: os.tmpdir(),
      runner: { kind: "shell", command: "true" },
      trigger: { kind: "schedule", schedule: "* * * * *" },
      ...patch,
    }),
  );
const attach = () =>
  new AutomationDispatcher({
    store,
    now: () => now,
    changed: () => {},
    launch: (automation, run) => {
      launched.push({ automation, run });
    },
  });
const finish = (id: string, runId: string) => {
  store.updateRun(id, runId, { status: "completed", finishedAt: now, exitCode: 0 });
  dispatcher.drain(id);
};

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-dispatch-"));
  file = path.join(directory, "automations.json");
  store = new AutomationStore(file);
  now = Date.now();
  launched = [];
  dispatcher = attach();
});
afterEach(() => {
  dispatcher.dispose();
  vi.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("AutomationDispatcher", () => {
  it.each(["schedule", "manual", "watch", "event", "webhook"] as const)(
    "applies the shared overlap guard to %s",
    (trigger) => {
      const automation = create();
      const first = dispatcher.request(automation.id, trigger, now);
      const second = dispatcher.request(automation.id, trigger, now + 1);
      expect(first).not.toBe(second);
      expect(launched).toHaveLength(1);
      expect(store.get(automation.id)?.runs[0]).toMatchObject({
        status: "skipped",
        reason: "overlap",
        countsTowardLimit: false,
      });
      dispatcher.request(automation.id, trigger, now + 2);
      expect(launched).toHaveLength(1);
    },
  );

  it("coalesces pending work to the latest request and starts it after completion", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    const first = dispatcher.request(automation.id, "schedule", now)!;
    const old = dispatcher.request(automation.id, "schedule", now + 1)!;
    const latest = dispatcher.request(automation.id, "schedule", now + 2)!;
    expect(store.get(automation.id)?.runCount).toBe(1);
    expect(store.get(automation.id)?.runs.find((run) => run.runId === old)).toMatchObject({
      status: "skipped",
      reason: "superseded",
    });
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      runId: latest,
      status: "queued",
      startedAt: null,
    });
    finish(automation.id, first);
    expect(launched.map(({ run }) => run.runId)).toEqual([first, latest]);
    expect(store.get(automation.id)?.runCount).toBe(2);
  });

  it("recovers only queued work with the accepted execution snapshot", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    const first = dispatcher.request(automation.id, "manual")!;
    const pending = dispatcher.request(automation.id, "manual")!;
    store.update(automation.id, { runner: { kind: "shell", command: "different" } });
    dispatcher.dispose();
    store = new AutomationStore(file);
    dispatcher = attach();
    dispatcher.recover();
    expect(launched.map(({ run }) => run.runId)).toEqual([first, pending]);
    expect(launched[1].automation.runner).toMatchObject({ command: "true" });
    expect(store.get(automation.id)?.runs.find((run) => run.runId === first)).toMatchObject({
      status: "interrupted",
      reason: "restart",
    });
  });

  it("deduplicates scheduled occurrences across restarts and history clearing", () => {
    const automation = create();
    const first = dispatcher.request(automation.id, "schedule", now)!;
    finish(automation.id, first);
    store.clearRuns(automation.id);
    dispatcher.dispose();
    store = new AutomationStore(file);
    dispatcher = attach();
    dispatcher.recover();
    expect(dispatcher.request(automation.id, "schedule", now)).toBeNull();
    expect(launched).toHaveLength(1);
    dispatcher.request(automation.id, "schedule", now + 1);
    expect(launched).toHaveLength(2);
  });

  it("keeps active work through history trimming, clearing and reset", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    const first = dispatcher.request(automation.id, "manual")!;
    for (let i = 0; i < AUTOMATION_RUN_HISTORY_CAP + 5; i++)
      dispatcher.request(automation.id, "manual");
    const pending = store.get(automation.id)?.runs[0].runId;
    expect(store.get(automation.id)?.runs.some((run) => run.runId === first)).toBe(true);
    expect(store.get(automation.id)?.runs).toHaveLength(AUTOMATION_RUN_HISTORY_CAP);
    store.clearRuns(automation.id);
    store.clearAllRuns();
    store.reset(automation.id, true);
    expect(store.get(automation.id)?.runs.map((run) => run.runId)).toEqual([pending, first]);
    finish(automation.id, first);
    expect(launched[1].run.runId).toBe(pending);
  });

  it("cancels only queued requests and never launches a cancelled request", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    const first = dispatcher.request(automation.id, "manual")!;
    const queued = dispatcher.request(automation.id, "manual")!;
    expect(dispatcher.cancel(automation.id, first)).toBe(false);
    expect(dispatcher.cancel(automation.id, queued)).toBe(true);
    expect(dispatcher.cancel(automation.id, queued)).toBe(false);
    finish(automation.id, first);
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      status: "cancelled",
      reason: "cancelled",
    });
  });

  it("drops queued automatic work when paused or its budget is exhausted", () => {
    const automation = create({
      concurrencyPolicy: "queue-latest",
      limit: { kind: "count", max: 2 },
    });
    const first = dispatcher.request(automation.id, "schedule", now)!;
    dispatcher.request(automation.id, "schedule", now + 1);
    store.update(automation.id, { enabled: false });
    dispatcher.drain(automation.id);
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      status: "cancelled",
      reason: "disabled",
    });
    finish(automation.id, first);
    store.update(automation.id, { enabled: true });
    const second = dispatcher.request(automation.id, "schedule", now + 1000)!;
    expect(second).not.toBeNull();
    expect(store.get(automation.id)?.lifecycle).toBe("finished");
    expect(dispatcher.request(automation.id, "schedule", now + 1001)).toBeNull();
    finish(automation.id, second);
    dispatcher.request(automation.id, "manual");
    expect(store.get(automation.id)?.runCount).toBe(2);
  });

  it("cancels accepted work if a later limit edit leaves no budget", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    const first = dispatcher.request(automation.id, "schedule", now)!;
    dispatcher.request(automation.id, "schedule", now + 1);
    store.update(automation.id, { limit: { kind: "count", max: 1 } });
    finish(automation.id, first);
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      status: "cancelled",
      reason: "limit",
    });
  });

  it("bounds opt-in parallel work", () => {
    const automation = create({ concurrencyPolicy: "allow" });
    for (let i = 0; i <= MAX_AUTOMATION_CONCURRENT_RUNS; i++)
      dispatcher.request(automation.id, "manual");
    expect(launched).toHaveLength(MAX_AUTOMATION_CONCURRENT_RUNS);
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      status: "skipped",
      reason: "capacity",
    });
  });

  it("serializes persistent threads even with an old allow configuration", () => {
    const automation = create({
      concurrencyPolicy: "allow",
      runner: {
        kind: "agent",
        prompt: "review",
        sessionMode: "thread",
        harness: { kind: "pi", extensions: true, skills: true, contextFiles: true },
      },
    });
    const first = dispatcher.request(automation.id, "manual")!;
    dispatcher.request(automation.id, "manual");
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runs[0].status).toBe("queued");
    finish(automation.id, first);
    expect(launched).toHaveLength(2);
  });

  it("takes an exclusive maintenance lock without racing new requests", () => {
    const automation = create({ concurrencyPolicy: "queue-latest" });
    expect(dispatcher.acquireExclusive(automation.id)).toBe(true);
    dispatcher.request(automation.id, "manual");
    expect(launched).toHaveLength(0);
    expect(dispatcher.acquireExclusive(automation.id)).toBe(false);
    dispatcher.releaseExclusive(automation.id);
    expect(launched).toHaveLength(1);
    expect(dispatcher.acquireExclusive(automation.id)).toBe(false);
  });

  it("does not admit or reserve an occurrence when persistence fails", () => {
    const automation = create();
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => dispatcher.request(automation.id, "schedule", now)).toThrow("disk full");
    expect(store.get(automation.id)?.runs).toEqual([]);
    expect(store.get(automation.id)?.lastScheduledAt).toBeUndefined();
    expect(launched).toHaveLength(0);
    dispatcher.request(automation.id, "schedule", now);
    expect(launched).toHaveLength(1);
  });

  it("recovers the durable queue if committing launch fails before side effects", () => {
    const automation = create();
    const rename = fs.renameSync;
    vi.spyOn(fs, "renameSync")
      .mockImplementationOnce(rename)
      .mockImplementationOnce(() => {
        throw new Error("disk full");
      });
    expect(() => dispatcher.request(automation.id, "schedule", now)).toThrow("disk full");
    expect(launched).toHaveLength(0);
    expect(store.get(automation.id)?.runCount).toBe(0);
    expect(store.get(automation.id)?.runs[0].status).toBe("queued");
    dispatcher.drain(automation.id);
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runCount).toBe(1);
    store = new AutomationStore(file);
    dispatcher = attach();
    dispatcher.recover();
    expect(launched).toHaveLength(1);
    expect(store.get(automation.id)?.runCount).toBe(1);
    expect(store.get(automation.id)?.runs[0].status).toBe("interrupted");
  });

  it("records skipped downtime without consuming budget or launching", () => {
    const automation = create();
    dispatcher.request(automation.id, "schedule", now, "downtime");
    expect(launched).toHaveLength(0);
    expect(store.get(automation.id)).toMatchObject({
      runCount: 0,
      lastScheduledAt: now,
      runs: [{ status: "skipped", reason: "downtime" }],
    });
  });

  it("settles synchronous launch failures and prevents dispatch after disposal", () => {
    const automation = create();
    dispatcher = new AutomationDispatcher({
      store,
      changed: () => {},
      launch: () => {
        throw new Error("cannot spawn");
      },
    });
    dispatcher.request(automation.id, "manual");
    expect(store.get(automation.id)?.runs[0]).toMatchObject({
      status: "failed",
      reason: "launch-failed",
    });
    dispatcher.dispose();
    expect(dispatcher.request(automation.id, "manual")).toBeNull();
  });
});
