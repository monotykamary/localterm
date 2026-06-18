import fs from "node:fs";
import path from "node:path";
import {
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT,
  CAFFEINATE_PREFERENCES_FILE_VERSION,
  MAX_CAFFEINATE_COMMAND_LENGTH,
  MAX_CAFFEINATE_COMMANDS,
} from "./constants.js";
import { caffeinatePreferencesFileSchema } from "./schemas.js";
import type { CaffeinateMode } from "./types.js";
import { memoBy } from "./utils/memo-by.js";

interface CaffeinatePreferences {
  mode: CaffeinateMode;
  activityGate: boolean;
  commands: string[];
  // `null` disables the battery floor; otherwise 5–50. Defaults on so a
  // machine left unplugged stops keeping itself awake before it dies.
  batteryThreshold: number | null;
}

// Default to "automatic": keep-awake follows recognized programs out of the box
// (the behavior the user asked to make default), with no custom commands yet.
// The activity gate is on by default: caffeinate only stays active while a
// recognized program is producing output. The battery floor is on at 20% by
// default: on battery power at or below that, the daemon refuses to keep awake.
const DEFAULT_PREFERENCES: CaffeinatePreferences = {
  mode: "automatic",
  activityGate: true,
  commands: [],
  batteryThreshold: CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT,
};

// Trim, drop empties, cap length, memo by lowercased form (keeping the first
// spelling), and cap the count. The trigger match itself is case-insensitive,
// so "Claude" and "claude" are the same trigger.
const sanitizeCommands = (commands: readonly string[]): string[] => {
  const capped = commands
    .map((raw) => raw.trim().slice(0, MAX_CAFFEINATE_COMMAND_LENGTH))
    .filter(Boolean);
  return memoBy(capped, (command) => command.toLowerCase()).slice(0, MAX_CAFFEINATE_COMMANDS);
};

// Owns the persisted keep-awake preferences (mode + custom automatic-mode
// trigger commands) in ~/.localterm/caffeinate.json. Mirrors AutomationStore's
// load/persist shape (zod-validated read, atomic tmp+rename write).
export class CaffeinatePreferencesStore {
  private preferences: CaffeinatePreferences = { ...DEFAULT_PREFERENCES };

  constructor(private readonly filePath: string) {
    this.load();
  }

  getMode(): CaffeinateMode {
    return this.preferences.mode;
  }

  getCommands(): string[] {
    return [...this.preferences.commands];
  }

  getActivityGate(): boolean {
    return this.preferences.activityGate;
  }

  getBatteryThreshold(): number | null {
    return this.preferences.batteryThreshold;
  }

  setActivityGate(enabled: boolean): boolean {
    if (enabled === this.preferences.activityGate) return this.preferences.activityGate;
    this.preferences = { ...this.preferences, activityGate: enabled };
    this.persist();
    return this.preferences.activityGate;
  }

  setBatteryThreshold(percent: number | null): number | null {
    const clamped =
      percent === null
        ? null
        : Math.min(
            CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
            Math.max(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT, Math.floor(percent)),
          );
    if (clamped === this.preferences.batteryThreshold) return this.preferences.batteryThreshold;
    this.preferences = { ...this.preferences, batteryThreshold: clamped };
    this.persist();
    return this.preferences.batteryThreshold;
  }

  setMode(mode: CaffeinateMode): CaffeinateMode {
    if (mode !== this.preferences.mode) {
      this.preferences = { ...this.preferences, mode };
      this.persist();
    }
    return this.preferences.mode;
  }

  setCommands(commands: readonly string[]): string[] {
    this.preferences = { ...this.preferences, commands: sanitizeCommands(commands) };
    this.persist();
    return [...this.preferences.commands];
  }

  private load(): void {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      console.warn(`caffeinate preferences file invalid; using defaults (${this.filePath})`);
      return;
    }
    // v1 files lack `activityGate`; migrate before validation.
    if (
      json &&
      typeof json === "object" &&
      "version" in json &&
      (json as Record<string, unknown>).version === 1 &&
      !("activityGate" in json)
    ) {
      (json as Record<string, unknown>).activityGate = true;
      (json as Record<string, unknown>).version = CAFFEINATE_PREFERENCES_FILE_VERSION;
    }
    // v2 files lack `batteryThreshold`; migrate before validation. Default to
    // the guard-on default rather than null so the floor lights up for existing
    // users on first boot after upgrade.
    if (
      json &&
      typeof json === "object" &&
      "version" in json &&
      (json as Record<string, unknown>).version === 2 &&
      !("batteryThreshold" in json)
    ) {
      (json as Record<string, unknown>).batteryThreshold =
        CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT;
      (json as Record<string, unknown>).version = CAFFEINATE_PREFERENCES_FILE_VERSION;
    }
    const parsed = caffeinatePreferencesFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`caffeinate preferences file invalid; using defaults (${this.filePath})`);
      return;
    }
    this.preferences = {
      mode: parsed.data.mode,
      activityGate: parsed.data.activityGate,
      commands: sanitizeCommands(parsed.data.commands),
      batteryThreshold: parsed.data.batteryThreshold,
    };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: CAFFEINATE_PREFERENCES_FILE_VERSION,
      mode: this.preferences.mode,
      activityGate: this.preferences.activityGate,
      batteryThreshold: this.preferences.batteryThreshold,
      commands: this.preferences.commands,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
