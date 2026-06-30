import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { readPiShellSettings } from "../src/utils/read-pi-shell-settings.js";

describe("readPiShellSettings", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(path.join(os.tmpdir(), "localterm-pi-shell-"));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it("returns undefined for both when no settings files exist", () => {
    const result = readPiShellSettings(workdir, {
      globalSettingsPath: path.join(workdir, "global-settings.json"),
      configDirName: ".pi",
    });
    expect(result).toEqual({ shellPath: undefined, commandPrefix: undefined });
  });

  it("reads shellPath and shellCommandPrefix from the global settings", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(
      globalSettingsPath,
      JSON.stringify({ shellPath: "/bin/zsh", shellCommandPrefix: "shopt -s expand_aliases" }),
    );
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result).toEqual({ shellPath: "/bin/zsh", commandPrefix: "shopt -s expand_aliases" });
  });

  it("lets project settings override global settings", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(globalSettingsPath, JSON.stringify({ shellPath: "/bin/bash" }));
    mkdirSync(path.join(workdir, ".pi"));
    writeFileSync(
      path.join(workdir, ".pi", "settings.json"),
      JSON.stringify({ shellPath: "/bin/zsh" }),
    );
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result.shellPath).toBe("/bin/zsh");
  });

  it("fills commandPrefix only from global when the project omits it", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(globalSettingsPath, JSON.stringify({ shellCommandPrefix: "source ~/.profile" }));
    mkdirSync(path.join(workdir, ".pi"));
    writeFileSync(
      path.join(workdir, ".pi", "settings.json"),
      JSON.stringify({ shellPath: "/bin/zsh" }),
    );
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result).toEqual({ shellPath: "/bin/zsh", commandPrefix: "source ~/.profile" });
  });

  it("treats an empty string as unset", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(globalSettingsPath, JSON.stringify({ shellPath: "", shellCommandPrefix: "" }));
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result).toEqual({ shellPath: undefined, commandPrefix: undefined });
  });

  it("ignores non-string values", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(globalSettingsPath, JSON.stringify({ shellPath: 123, shellCommandPrefix: null }));
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result).toEqual({ shellPath: undefined, commandPrefix: undefined });
  });

  it("ignores a malformed settings file", () => {
    const globalSettingsPath = path.join(workdir, "global-settings.json");
    writeFileSync(globalSettingsPath, "{ broken");
    const result = readPiShellSettings(workdir, { globalSettingsPath, configDirName: ".pi" });
    expect(result).toEqual({ shellPath: undefined, commandPrefix: undefined });
  });
});
