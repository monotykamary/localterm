import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { PI_SETTINGS_FILENAME } from "../constants.js";

interface ShellSettings {
  shellPath: string | undefined;
  commandPrefix: string | undefined;
}

interface ShellSettingsPaths {
  globalSettingsPath?: string;
  configDirName?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readJsonFile = (filePath: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const readNonEmptyString = (settings: Record<string, unknown>, key: string): string | undefined => {
  const value = settings[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

// Resolve the two shell settings pi's built-in bash tool bakes in at
// construction — `shellPath` (override the shell binary) and
// `shellCommandPrefix` (prepended to every command, e.g. "shopt -s
// expand_aliases"). This extension overrides the `bash` tool by name to inject
// a spawnHook, so it reconstructs the tool — and must pass these through
// unchanged, or a user who configured them silently loses them. Reads the same
// two files pi's SettingsManager merges (global ~/.pi/agent/settings.json +
// project <cwd>/.pi/settings.json); project wins. A shallow merge suffices
// because both keys are top-level scalars. `paths` is overridable for tests so
// they never touch the real pi settings.
export const readPiShellSettings = (cwd: string, paths: ShellSettingsPaths = {}): ShellSettings => {
  const globalSettingsPath = paths.globalSettingsPath ?? join(getAgentDir(), PI_SETTINGS_FILENAME);
  const configDirName = paths.configDirName ?? CONFIG_DIR_NAME;
  const merged: Record<string, unknown> = {
    ...readJsonFile(globalSettingsPath),
    ...readJsonFile(join(cwd, configDirName, PI_SETTINGS_FILENAME)),
  };
  return {
    shellPath: readNonEmptyString(merged, "shellPath"),
    commandPrefix: readNonEmptyString(merged, "shellCommandPrefix"),
  };
};
