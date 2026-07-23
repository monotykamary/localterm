import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { HerdrThemeSync } from "../src/herdr-theme-sync.js";
import { getHerdrConfigPaths } from "../src/utils/get-herdr-config-paths.js";
import { isHerdrProcess } from "../src/utils/is-herdr-process.js";
import { parseHerdrThemeConfig } from "../src/utils/parse-herdr-theme-config.js";
import { resolveHerdrThemeId } from "../src/utils/resolve-herdr-theme-id.js";

const DEBOUNCE_MS = 50;

interface FakeHerdrConfigFile {
  content: string;
  modifiedAtMs: number;
}

interface FakeWatchListeners {
  change: (filename: string | null) => void;
  error: () => void;
}

const makeFakeWatch = () => {
  const listeners = new Map<string, FakeWatchListeners>();
  const watchDirectory = (
    directory: string,
    listener: (filename: string | null) => void,
    errorListener: () => void,
  ) => {
    const record = { change: listener, error: errorListener };
    listeners.set(directory, record);
    return {
      close: () => {
        if (listeners.get(directory) === record) listeners.delete(directory);
      },
    };
  };
  return {
    listeners,
    watchDirectory,
    fire: (directory: string, filename: string | null = null) =>
      listeners.get(directory)?.change(filename),
    fail: (directory: string) => listeners.get(directory)?.error(),
  };
};

describe("Herdr theme utilities", () => {
  it("parses the applied theme without reading custom color tables", () => {
    const content = [
      "",
      "[theme]",
      'name = "catppuccin-latte" # selected in settings',
      "auto_switch = false",
      "",
      "[theme.custom]",
      'accent = "#123456"',
      "",
    ].join("\n");
    expect(parseHerdrThemeConfig(content)).toEqual({
      themeName: "catppuccin-latte",
      autoSwitch: false,
    });
  });

  it("parses opt-in host appearance switching", () => {
    expect(parseHerdrThemeConfig("[theme]\nname = 'dracula'\nauto_switch = true\n")).toEqual({
      themeName: "dracula",
      autoSwitch: true,
    });
  });

  it("maps compatible aliases and ignores unavailable themes", () => {
    expect(resolveHerdrThemeId("catppuccin")).toBe("catppuccin-mocha");
    expect(resolveHerdrThemeId("Gruvbox Dark")).toBe("gruvbox-dark");
    expect(resolveHerdrThemeId("one_dark")).toBe("one-dark-pro");
    expect(resolveHerdrThemeId("Tokyo Night Day")).toBe("tokyo-night-day");
    expect(resolveHerdrThemeId("tokyonight-day")).toBe("tokyo-night-day");
    expect(resolveHerdrThemeId("terminal")).toBeNull();
    expect(resolveHerdrThemeId("rose-pine")).toBeNull();
  });

  it("resolves explicit, XDG, and default config paths", () => {
    expect(
      getHerdrConfigPaths({
        environment: { HERDR_CONFIG_PATH: "/explicit/herdr.toml" },
        homeDirectory: "/home/tester",
      }),
    ).toEqual(["/explicit/herdr.toml"]);
    expect(
      getHerdrConfigPaths({
        environment: { XDG_CONFIG_HOME: "/custom/config" },
        homeDirectory: "/home/tester",
      }),
    ).toEqual(["/custom/config/herdr/config.toml", "/custom/config/herdr-dev/config.toml"]);
    expect(getHerdrConfigPaths({ environment: {}, homeDirectory: "/home/tester" })).toEqual([
      "/home/tester/.config/herdr/config.toml",
      "/home/tester/.config/herdr-dev/config.toml",
    ]);
  });

  it("recognizes Herdr executable paths on Unix and Windows", () => {
    expect(isHerdrProcess("herdr")).toBe(true);
    expect(isHerdrProcess("/opt/homebrew/bin/herdr")).toBe(true);
    expect(isHerdrProcess("C:\\tools\\herdr.exe")).toBe(true);
    expect(isHerdrProcess("cargo")).toBe(false);
  });
});

describe("HerdrThemeSync", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    vi.useFakeTimers();
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "localterm-herdr-theme-"));
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("reconciles the newest Herdr config when activated", () => {
    const releaseDirectory = path.join(temporaryDirectory, "herdr");
    const developmentDirectory = path.join(temporaryDirectory, "herdr-dev");
    fs.mkdirSync(releaseDirectory);
    fs.mkdirSync(developmentDirectory);
    const releasePath = path.join(releaseDirectory, "config.toml");
    const developmentPath = path.join(developmentDirectory, "config.toml");
    const configFiles = new Map([
      [releasePath, { content: '[theme]\nname = "dracula"\n', modifiedAtMs: 1 }],
      [developmentPath, { content: '[theme]\nname = "catppuccin-latte"\n', modifiedAtMs: 2 }],
    ]);
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [releasePath, developmentPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });

    sync.setActive(true);

    expect(themes).toEqual(["catppuccin-latte"]);
    expect(fakeWatch.listeners.has(releaseDirectory)).toBe(true);
    expect(fakeWatch.listeners.has(developmentDirectory)).toBe(true);
    sync.dispose();
  });

  it("applies a supported config change after the quiet window", () => {
    const configDirectory = path.join(temporaryDirectory, "herdr");
    fs.mkdirSync(configDirectory);
    const configPath = path.join(configDirectory, "config.toml");
    const configFiles = new Map([
      [configPath, { content: '[theme]\nname = "dracula"\n', modifiedAtMs: 1 }],
    ]);
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [configPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });
    sync.setActive(true);
    themes.length = 0;
    configFiles.set(configPath, {
      content: '[theme]\nname = "solarized-light"\n',
      modifiedAtMs: 2,
    });

    fakeWatch.fire(configDirectory, "herdr.sock");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(themes).toEqual([]);

    fakeWatch.fire(configDirectory, "config.toml");
    expect(themes).toEqual([]);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(themes).toEqual(["solarized-light"]);
    sync.dispose();
  });

  it("ignores automatic and unsupported Herdr themes", () => {
    const configDirectory = path.join(temporaryDirectory, "herdr");
    fs.mkdirSync(configDirectory);
    const configPath = path.join(configDirectory, "config.toml");
    const configFiles = new Map([
      [configPath, { content: '[theme]\nname = "dracula"\nauto_switch = true\n', modifiedAtMs: 1 }],
    ]);
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [configPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });

    sync.setActive(true);
    configFiles.set(configPath, {
      content: '[theme]\nname = "rose-pine"\n',
      modifiedAtMs: 2,
    });
    fakeWatch.fire(configDirectory);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(themes).toEqual([]);
    sync.dispose();
  });

  it("moves its watcher from an ancestor when Herdr creates its config directory", () => {
    const configDirectory = path.join(temporaryDirectory, "herdr");
    const configPath = path.join(configDirectory, "config.toml");
    const configFiles = new Map<string, FakeHerdrConfigFile>();
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [configPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });
    sync.setActive(true);
    expect(fakeWatch.listeners.has(temporaryDirectory)).toBe(true);
    fs.mkdirSync(configDirectory);
    configFiles.set(configPath, {
      content: '[theme]\nname = "nord"\n',
      modifiedAtMs: 1,
    });

    fakeWatch.fire(temporaryDirectory, "herdr");
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(fakeWatch.listeners.has(temporaryDirectory)).toBe(false);
    expect(fakeWatch.listeners.has(configDirectory)).toBe(true);
    expect(themes).toEqual(["nord"]);
    sync.dispose();
  });

  it("re-arms an ancestor after a watched directory becomes unavailable", () => {
    const configDirectory = path.join(temporaryDirectory, "herdr");
    fs.mkdirSync(configDirectory);
    const configPath = path.join(configDirectory, "config.toml");
    const configFiles = new Map([
      [configPath, { content: '[theme]\nname = "dracula"\n', modifiedAtMs: 1 }],
    ]);
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [configPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });
    sync.setActive(true);
    themes.length = 0;
    configFiles.delete(configPath);
    fs.rmSync(configDirectory, { recursive: true });

    fakeWatch.fail(configDirectory);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(fakeWatch.listeners.has(configDirectory)).toBe(false);
    expect(fakeWatch.listeners.has(temporaryDirectory)).toBe(true);
    expect(themes).toEqual([]);
    sync.dispose();
  });

  it("stops watching and drops pending changes when deactivated", () => {
    const configDirectory = path.join(temporaryDirectory, "herdr");
    fs.mkdirSync(configDirectory);
    const configPath = path.join(configDirectory, "config.toml");
    const configFiles = new Map([
      [configPath, { content: '[theme]\nname = "dracula"\n', modifiedAtMs: 1 }],
    ]);
    const themes: string[] = [];
    const fakeWatch = makeFakeWatch();
    const sync = new HerdrThemeSync({
      configPaths: [configPath],
      debounceMs: DEBOUNCE_MS,
      onThemeChange: (themeId) => themes.push(themeId),
      readConfigFile: (filePath) => configFiles.get(filePath) ?? null,
      watchDirectory: fakeWatch.watchDirectory,
    });
    sync.setActive(true);
    themes.length = 0;
    fakeWatch.fire(configDirectory, "config.toml");

    sync.setActive(false);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(themes).toEqual([]);
    expect(fakeWatch.listeners.size).toBe(0);
    sync.dispose();
  });
});
