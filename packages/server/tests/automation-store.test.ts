import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { AutomationStore } from "../src/automation-store.js";

const createInput = {
  name: "nightly build",
  schedule: "0 2 * * *",
  cwd: os.tmpdir(),
  command: "pnpm build",
};

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

  it("creates an automation with defaults and persists it", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    expect(automation.id).toMatch(/[0-9a-f-]{36}/);
    expect(automation.enabled).toBe(true);
    expect(automation.lastRun).toBeNull();
    expect(automation.createdAt).toBe(automation.updatedAt);

    const reloaded = new AutomationStore(filePath);
    expect(reloaded.list()).toEqual([automation]);
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

  it("records last run results", () => {
    const store = new AutomationStore(filePath);
    const automation = store.create(createInput);
    const lastRun = { runId: "run-1", at: Date.now(), status: "completed" as const, exitCode: 0 };
    const updated = store.recordLastRun(automation.id, lastRun);
    expect(updated?.lastRun).toEqual(lastRun);
    expect(new AutomationStore(filePath).get(automation.id)?.lastRun).toEqual(lastRun);
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
