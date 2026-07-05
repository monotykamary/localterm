import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CaffeinatePreferencesStore } from "../src/caffeinate-preferences-store.js";
import {
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT,
} from "../src/constants.js";

describe("CaffeinatePreferencesStore", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = path.join(os.tmpdir(), `localterm-caffeinate-prefs-${randomUUID()}`);
    filePath = path.join(dir, "caffeinate.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to automatic mode with no commands when no file exists", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getMode()).toBe("automatic");
    expect(store.getActivityGate()).toBe(true);
    expect(store.getPeerKeepAwake()).toBe(true);
    expect(store.getCommands()).toEqual([]);
  });

  it("defaults the battery threshold to 20% when no file exists", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getBatteryThreshold()).toBe(20);
  });

  it("persists mode, activity gate, peer keep-awake, and commands across reloads", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    store.setMode("on");
    store.setActivityGate(false);
    store.setPeerKeepAwake(false);
    store.setCommands(["ollama"]);

    const reloaded = new CaffeinatePreferencesStore(filePath);
    expect(reloaded.getMode()).toBe("on");
    expect(reloaded.getActivityGate()).toBe(false);
    expect(reloaded.getPeerKeepAwake()).toBe(false);
    expect(reloaded.getCommands()).toEqual(["ollama"]);
  });

  it("persists the battery threshold across reloads, including null", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    store.setBatteryThreshold(30);
    expect(store.getBatteryThreshold()).toBe(30);

    const mid = new CaffeinatePreferencesStore(filePath);
    expect(mid.getBatteryThreshold()).toBe(30);

    mid.setBatteryThreshold(null);
    const reloaded = new CaffeinatePreferencesStore(filePath);
    expect(reloaded.getBatteryThreshold()).toBeNull();
  });

  it("clamps out-of-range battery thresholds into bounds", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    store.setBatteryThreshold(2);
    expect(store.getBatteryThreshold()).toBe(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT);
    store.setBatteryThreshold(99);
    expect(store.getBatteryThreshold()).toBe(CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT);
  });

  it("trims, drops empties, and de-duplicates commands case-insensitively", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    store.setCommands(["  ollama ", "", "Ollama", "lazygit"]);
    expect(store.getCommands()).toEqual(["ollama", "lazygit"]);
  });

  it("caps the number of commands", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    const many = Array.from({ length: 100 }, (_, index) => `cmd${index}`);
    store.setCommands(many);
    expect(store.getCommands()).toHaveLength(50);
  });

  it("falls back to defaults on an invalid file", () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, "{ not valid json", "utf8");
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getMode()).toBe("automatic");
    expect(store.getActivityGate()).toBe(true);
    expect(store.getCommands()).toEqual([]);
  });

  it("migrates v1 files by defaulting activityGate to true", () => {
    fs.mkdirSync(dir, { recursive: true });
    const v1 = { version: 1, mode: "automatic", commands: [] };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getActivityGate()).toBe(true);
  });

  it("migrates v1 files by defaulting batteryThreshold to the floor default", () => {
    fs.mkdirSync(dir, { recursive: true });
    const v1 = { version: 1, mode: "automatic", activityGate: false, commands: [] };
    fs.writeFileSync(filePath, JSON.stringify(v1), "utf8");
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getBatteryThreshold()).toBe(CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT);
  });

  it("migrates v2 files by defaulting batteryThreshold to the floor default", () => {
    fs.mkdirSync(dir, { recursive: true });
    const v2 = { version: 2, mode: "on", activityGate: true, commands: ["ollama"] };
    fs.writeFileSync(filePath, JSON.stringify(v2), "utf8");
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getBatteryThreshold()).toBe(CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT);
    expect(store.getMode()).toBe("on");
    expect(store.getCommands()).toEqual(["ollama"]);
  });

  it("migrates v3 files by defaulting peerKeepAwake to true", () => {
    fs.mkdirSync(dir, { recursive: true });
    const v3 = {
      version: 3,
      mode: "on",
      activityGate: true,
      batteryThreshold: 20,
      commands: ["ollama"],
    };
    fs.writeFileSync(filePath, JSON.stringify(v3), "utf8");
    const store = new CaffeinatePreferencesStore(filePath);
    expect(store.getPeerKeepAwake()).toBe(true);
    expect(store.getMode()).toBe("on");
    expect(store.getBatteryThreshold()).toBe(20);
    expect(store.getCommands()).toEqual(["ollama"]);
  });
});
