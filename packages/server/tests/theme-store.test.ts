import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ThemeStore } from "../src/theme-store.js";
import { DEFAULT_TERMINAL_THEME_ID } from "../src/terminal-themes.js";

const themeFile = (stateDirectory: string): string => path.join(stateDirectory, "themes.json");

const customTheme = (
  id: string,
  name = id,
): { id: string; name: string; source: string; colors: Record<string, string> } => ({
  id,
  name,
  source: "imported",
  colors: { background: "#0a0a0a", foreground: "#eeeeee" },
});

describe("ThemeStore", () => {
  let stateDirectory: string;

  beforeEach(() => {
    stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-themes-"));
  });

  afterEach(() => {
    fs.rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("defaults to the built-in default theme + no customs + uninitialized", () => {
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_THEME_ID);
    expect(store.list()).toEqual([]);
    expect(store.isInitialized()).toBe(false);
  });

  it("adds + lists custom themes and persists across a new instance", () => {
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    const stored = store.add(customTheme("custom-1", "Mine"));
    expect(stored?.id).toBe("custom-1");
    expect(store.list().map((theme) => theme.id)).toEqual(["custom-1"]);
    expect(store.isInitialized()).toBe(true);

    const reloaded = new ThemeStore({ filePath: themeFile(stateDirectory) });
    expect(reloaded.list().map((theme) => theme.id)).toEqual(["custom-1"]);
    expect(reloaded.isInitialized()).toBe(true);
  });

  it("deletes a custom theme and resets the active id when it was active", () => {
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    store.add(customTheme("custom-1"));
    store.setActive("custom-1");
    expect(store.getActive()).toBe("custom-1");

    expect(store.delete("custom-1")).toBe(true);
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_THEME_ID);
    expect(store.list()).toEqual([]);
    expect(store.delete("custom-1")).toBe(false);
  });

  it("setActive keeps any built-in or custom id as-is (the route validates)", () => {
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    store.setActive("dracula");
    expect(store.getActive()).toBe("dracula");
    store.add(customTheme("custom-1"));
    store.setActive("custom-1");
    expect(store.getActive()).toBe("custom-1");
  });

  it("sanitizes a stale active id (a deleted custom) back to the default on load", () => {
    fs.writeFileSync(
      themeFile(stateDirectory),
      JSON.stringify({
        version: 1,
        activeThemeId: "custom-gone",
        customThemes: [],
      }),
    );
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_THEME_ID);
    expect(store.isInitialized()).toBe(true);
  });

  it("migrate adopts the payload once, preserving ids, then no-ops", () => {
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    expect(store.isInitialized()).toBe(false);

    const adopted = store.migrate("dracula", [customTheme("custom-1", "Mine")]);
    expect(adopted).toBe(true);
    expect(store.getActive()).toBe("dracula");
    expect(store.list().map((theme) => theme.id)).toEqual(["custom-1"]);
    expect(store.isInitialized()).toBe(true);

    // A second call (e.g. another tab) must not clobber the now-initialized store.
    const second = store.migrate("vesper", [customTheme("custom-2", "Other")]);
    expect(second).toBe(false);
    expect(store.getActive()).toBe("dracula");
    expect(store.list().map((theme) => theme.id)).toEqual(["custom-1"]);
  });

  it("ignores an unparseable file and keeps the defaults", () => {
    fs.writeFileSync(themeFile(stateDirectory), "{not json");
    const store = new ThemeStore({ filePath: themeFile(stateDirectory) });
    expect(store.getActive()).toBe(DEFAULT_TERMINAL_THEME_ID);
    expect(store.list()).toEqual([]);
    expect(store.isInitialized()).toBe(false);
  });
});
