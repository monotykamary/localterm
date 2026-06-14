import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AutomationStore } from "../src/automation-store.js";
import { AUTOMATION_RUN_HISTORY_CAP, AUTOMATIONS_FILE_VERSION } from "../src/constants.js";
import type { AutomationRunRecord, CreateAutomationInput } from "../src/types.js";

const createInput: CreateAutomationInput = {
  name: "nightly build",
  trigger: { kind: "schedule", schedule: { kind: "daily", hour: 2, minute: 0 } },
  cwd: os.tmpdir(),
  command: "pnpm build",
};

const runRecord = (overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord => ({
  runId: "run-1",
  scheduledFor: 1000,
  startedAt: 1000,
  finishedAt: null,
  status: "launched",
  exitCode: null,
  trigger: "schedule",
  countsTowardLimit: true,
  ...overrides,
});

describe("AutomationStore", () => {
  let stateDirectory: string;
  let filePath: string;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-automations-"));
    filePath = path.join(stateDirectory, "automations.json");
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("starts empty when no file exists", () => {
    const store = new AutomationStore(filePath);
    expect(store.list()).toEqual([]);
    expect(store.size()).toBe(0);
  });

  it("creates an automation with v3 defaults and persists it", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    expect(automation.id).toMatch(/[0-9a-f-]{36}/);
    expect(automation.enabled).toBe(true);
    expect(automation.runs).toEqual([]);
    expect(automation.runCount).toBe(0);
    expect(automation.lifecycle).toBe("active");
    expect(automation.limit).toEqual({ kind: "forever" });
    expect(automation.closeOnFinish).toBe(false);
    expect(automation.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "daily", hour: 2, minute: 0 },
    });
    expect(automation.createdAt).toBe(automation.updatedAt);

    const reloaded = new AutomationStore(filePath);
    expect(reloaded.list()).toEqual([automation]);
  });

  it("honors closeOnFinish on create, toggles it on update, and persists it", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create({ ...createInput, closeOnFinish: true });
    expect(automation.closeOnFinish).toBe(true);

    const updated = store.update(automation.id, { closeOnFinish: false });
    expect(updated?.closeOnFinish).toBe(false);
    // An update that omits closeOnFinish leaves it untouched.
    const renamed = store.update(automation.id, { name: "renamed" });
    expect(renamed?.closeOnFinish).toBe(false);

    const reloaded = new AutomationStore(filePath);
    expect(reloaded.get(automation.id)?.closeOnFinish).toBe(false);
  });

  it("defaults closeOnFinish to false when absent from a persisted v3 file", () => {
    // A file written before closeOnFinish existed has no such field.
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: AUTOMATIONS_FILE_VERSION,
        automations: [
          {
            id: "legacy",
            name: "legacy",
            trigger: { kind: "schedule", schedule: { kind: "daily", hour: 2, minute: 0 } },
            cwd: "/tmp",
            command: "echo hi",
            enabled: true,
            limit: { kind: "forever" },
            runCount: 0,
            lifecycle: "active",
            runs: [],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );
    const store = new AutomationStore(filePath);
    expect(store.get("legacy")?.closeOnFinish).toBe(false);
  });

  it("coerces a legacy bare cron string into a friendly schedule trigger", () => {
    const store = new AutomationStore(filePath);
    // Legacy `schedule` body (no `trigger`) is wrapped into a schedule trigger.
    const automation = store.create({
      name: createInput.name,
      cwd: createInput.cwd,
      command: createInput.command,
      trigger: { kind: "schedule", schedule: "0 9 * * 1-5" },
    });
    expect(automation.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "weekdaysPreset", preset: "weekdays", hour: 9, minute: 0 },
    });
  });

  it("keeps an unrecognizable cron string as a raw cron schedule", () => {
    const store = new AutomationStore(filePath);
    // Both day fields restricted -> Vixie OR semantics; no preset matches.
    const automation = store.create({
      name: createInput.name,
      cwd: createInput.cwd,
      command: createInput.command,
      trigger: { kind: "schedule", schedule: "0 9 1 * 1" },
    });
    expect(automation.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "cron", expression: "0 9 1 * 1" },
    });
  });

  it("updates only the provided fields", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    const updated = store.update(automation.id, { enabled: false, name: "renamed" });
    expect(updated).not.toBeNull();
    expect(updated?.enabled).toBe(false);
    expect(updated?.name).toBe("renamed");
    expect(updated?.command).toBe(createInput.command);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(automation.updatedAt);
  });

  it("returns null when updating an unknown id", () => {
    const store = new AutomationStore(filePath);
    expect(store.update("missing", { name: "nope" })).toBeNull();
  });

  it("removes automations", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    expect(store.remove(automation.id)).toBe(true);
    expect(store.remove(automation.id)).toBe(false);
    expect(new AutomationStore(filePath).list()).toEqual([]);
  });

  it("appends runs newest-first and trims to the history cap", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    for (let index = 0; index < AUTOMATION_RUN_HISTORY_CAP + 5; index += 1) {
      store.appendRun(automation.id, runRecord({ runId: `run-${index}`, scheduledFor: index }));
    }
    const stored = store.get(automation.id);
    expect(stored?.runs).toHaveLength(AUTOMATION_RUN_HISTORY_CAP);
    expect(stored?.runs[0]?.runId).toBe(`run-${AUTOMATION_RUN_HISTORY_CAP + 4}`);
  });

  it("advances an existing run in place via updateRun", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    store.appendRun(automation.id, runRecord({ runId: "run-x", status: "launched" }));
    const updated = store.updateRun(automation.id, "run-x", {
      status: "completed",
      exitCode: 0,
      finishedAt: 2000,
    });
    expect(updated?.runs[0]).toMatchObject({ status: "completed", exitCode: 0, finishedAt: 2000 });
    expect(store.updateRun(automation.id, "missing-run", { status: "missed" })).toBeNull();
  });

  it("counts launched runs toward a limit and finishes when exhausted", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create({ ...createInput, limit: { kind: "count", max: 2 } });
    expect(store.incrementRunCount(automation.id)?.lifecycle).toBe("active");
    const finished = store.incrementRunCount(automation.id);
    expect(finished?.runCount).toBe(2);
    expect(finished?.lifecycle).toBe("finished");
  });

  it("finishes immediately when a PATCH lowers the limit below the run count", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    store.incrementRunCount(automation.id);
    store.incrementRunCount(automation.id);
    const updated = store.update(automation.id, { limit: { kind: "count", max: 1 } });
    expect(updated?.lifecycle).toBe("finished");
  });

  it("never un-finishes through a normal update", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create({ ...createInput, limit: { kind: "count", max: 1 } });
    store.incrementRunCount(automation.id);
    expect(store.get(automation.id)?.lifecycle).toBe("finished");
    const updated = store.update(automation.id, { name: "renamed", limit: { kind: "forever" } });
    expect(updated?.lifecycle).toBe("finished");
  });

  it("reset re-activates, zeroes the count, re-enables, and preserves history by default", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create({ ...createInput, limit: { kind: "count", max: 1 } });
    store.appendRun(automation.id, runRecord({ runId: "r1" }));
    store.incrementRunCount(automation.id);
    store.update(automation.id, { enabled: false });

    const reset = store.reset(automation.id);
    expect(reset?.runCount).toBe(0);
    expect(reset?.lifecycle).toBe("active");
    expect(reset?.enabled).toBe(true);
    expect(reset?.runs).toHaveLength(1);

    const cleared = store.reset(automation.id, true);
    expect(cleared?.runs).toEqual([]);
  });

  it("migrates a v1 file to v3, folding lastRun into run history", () => {
    const v1 = {
      version: 1,
      automations: [
        {
          id: "a1",
          name: "nightly",
          schedule: "0 9 * * *",
          cwd: os.tmpdir(),
          command: "echo hi",
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
          lastRun: { runId: "old-run", at: 5, status: "completed", exitCode: 0 },
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");

    const store = new AutomationStore(filePath);
    const [automation] = store.list();
    expect(automation.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });
    expect(automation.limit).toEqual({ kind: "forever" });
    expect(automation.runCount).toBe(0);
    expect(automation.lifecycle).toBe("active");
    expect(automation.runs).toEqual([
      {
        runId: "old-run",
        scheduledFor: 5,
        startedAt: 5,
        finishedAt: 5,
        status: "completed",
        exitCode: 0,
        trigger: "schedule",
        countsTowardLimit: true,
      },
    ]);

    // The migration persists as v3 so later loads hit the fast path.
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(persisted.version).toBe(3);
  });

  it("migrates a v1 automation with a null lastRun to empty history", () => {
    const v1 = {
      version: 1,
      automations: [
        {
          id: "a",
          name: "n",
          schedule: "0 9 * * *",
          cwd: os.tmpdir(),
          command: "x",
          enabled: false,
          createdAt: 1,
          updatedAt: 2,
          lastRun: null,
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");
    expect(new AutomationStore(filePath).list()[0]?.runs).toEqual([]);
  });

  it("keeps an unrecognizable v1 cron as raw cron (lossless)", () => {
    const v1 = {
      version: 1,
      automations: [
        {
          id: "a",
          name: "n",
          schedule: "0 9 1 * 1",
          cwd: os.tmpdir(),
          command: "x",
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
          lastRun: null,
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");
    expect(new AutomationStore(filePath).list()[0]?.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "cron", expression: "0 9 1 * 1" },
    });
  });

  it("migrates a missed v1 lastRun without counting it toward a limit", () => {
    const v1 = {
      version: 1,
      automations: [
        {
          id: "a",
          name: "n",
          schedule: "0 9 * * *",
          cwd: os.tmpdir(),
          command: "x",
          enabled: true,
          createdAt: 1,
          updatedAt: 2,
          lastRun: { runId: "r", at: 9, status: "missed", exitCode: null },
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");
    const [automation] = new AutomationStore(filePath).list();
    expect(automation.runs[0]).toMatchObject({
      status: "missed",
      finishedAt: 9,
      countsTowardLimit: false,
    });
  });

  it("migrates a v2 file to v3, wrapping the bare schedule in a trigger", () => {
    const v2 = {
      version: 2,
      automations: [
        {
          id: "a2",
          name: "nightly",
          schedule: { kind: "daily", hour: 9, minute: 0 },
          cwd: os.tmpdir(),
          command: "echo hi",
          enabled: true,
          limit: { kind: "forever" },
          closeOnFinish: false,
          runCount: 0,
          lifecycle: "active",
          runs: [],
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    };
    fs.writeFileSync(filePath, JSON.stringify(v2), "utf8");

    const [automation] = new AutomationStore(filePath).list();
    expect(automation.trigger).toEqual({
      kind: "schedule",
      schedule: { kind: "daily", hour: 9, minute: 0 },
    });

    // The migration persists as v3 (no leftover top-level schedule).
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(persisted.version).toBe(3);
    expect(persisted.automations[0].schedule).toBeUndefined();
  });

  it("creates a watch automation, defaulting recursive to true", () => {
    const store = new AutomationStore(filePath);
    const explicit = store.create({ ...createInput, trigger: { kind: "watch", recursive: false } });
    expect(explicit.trigger).toEqual({ kind: "watch", recursive: false });

    const defaulted = store.create({ ...createInput, trigger: { kind: "watch" } });
    expect(defaulted.trigger).toEqual({ kind: "watch", recursive: true });
  });

  it("switches a schedule automation to a watch trigger via update", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    const updated = store.update(automation.id, { trigger: { kind: "watch", recursive: true } });
    expect(updated?.trigger).toEqual({ kind: "watch", recursive: true });

    const reloaded = new AutomationStore(filePath);
    expect(reloaded.get(automation.id)?.trigger).toEqual({ kind: "watch", recursive: true });
  });

  it("starts empty when the file is corrupt", () => {
    fs.writeFileSync(filePath, "{not json", "utf8");
    const store = new AutomationStore(filePath);
    expect(store.list()).toEqual([]);
  });

  it("starts empty when the file fails schema validation", () => {
    fs.writeFileSync(filePath, JSON.stringify({ version: 999, automations: "nope" }), "utf8");
    const store = new AutomationStore(filePath);
    expect(store.list()).toEqual([]);
  });
});
