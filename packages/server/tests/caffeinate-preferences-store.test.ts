import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CaffeinatePreferencesStore } from "../src/caffeinate-preferences-store.js";

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
    expect(store.getCommands()).toEqual([]);
  });

  it("persists mode and commands across reloads", () => {
    const store = new CaffeinatePreferencesStore(filePath);
    store.setMode("on");
    store.setCommands(["ollama"]);

    const reloaded = new CaffeinatePreferencesStore(filePath);
    expect(reloaded.getMode()).toBe("on");
    expect(reloaded.getCommands()).toEqual(["ollama"]);
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
    expect(store.getCommands()).toEqual([]);
  });
});
