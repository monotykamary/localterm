import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AutomationScheduler } from "../src/automation-scheduler.js";
import { AutomationStore } from "../src/automation-store.js";
import type { Automation } from "../src/types.js";

describe("AutomationScheduler", () => {
  let stateDirectory: string;
  let store: AutomationStore;
  let scheduler: AutomationScheduler;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-scheduler-"));
    store = new AutomationStore(path.join(stateDirectory, "automations.json"));
    scheduler = new AutomationScheduler(store);
  });

  afterEach(() => {
    scheduler.dispose();
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  const createAutomation = (overrides: Partial<Automation> = {}) =>
    store.create({
      name: "every minute",
      schedule: "* * * * *",
      cwd: os.tmpdir(),
      command: "true",
      ...overrides,
    });

  it("emits due for enabled automations whose cron matches the tick", () => {
    const automation = createAutomation();
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 0));
    expect(due.map((entry) => entry.id)).toEqual([automation.id]);
  });

  it("skips disabled automations", () => {
    createAutomation();
    store.update(store.list()[0].id, { enabled: false });
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 0));
    expect(due).toEqual([]);
  });

  it("skips automations whose schedule does not match", () => {
    createAutomation({ schedule: "30 2 * * *" });
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 0));
    expect(due).toEqual([]);
  });

  it("never fires twice for the same automation and minute", () => {
    createAutomation();
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 5));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 40));
    scheduler.runTick(new Date(2026, 5, 13, 10, 16, 5));
    expect(due).toHaveLength(2);
  });

  it("tolerates invalid schedules without firing", () => {
    const valid = createAutomation();
    const invalid = createAutomation();
    store.update(invalid.id, { schedule: "not a cron" });
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 0));
    expect(due.map((entry) => entry.id)).toEqual([valid.id]);
  });

  it("emits tick after evaluating automations", () => {
    const ticks: Date[] = [];
    scheduler.on("tick", (now) => ticks.push(now));
    const now = new Date(2026, 5, 13, 10, 15, 0);
    scheduler.runTick(now);
    expect(ticks).toEqual([now]);
  });

  it("stops emitting after dispose", () => {
    createAutomation();
    const due: Automation[] = [];
    scheduler.on("due", (dueAutomation) => due.push(dueAutomation));
    scheduler.dispose();
    scheduler.runTick(new Date(2026, 5, 13, 10, 15, 0));
    expect(due).toEqual([]);
  });
});
