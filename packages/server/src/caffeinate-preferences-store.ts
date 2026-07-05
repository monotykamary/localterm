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
  // Whether automatic mode also caffeinates while a session has a second
  // client attached (a phone via the share QR, or another tab via the session
  // picker). Held for the peer's lifetime and bypasses the activity gate.
  peerKeepAwake: boolean;
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
  peerKeepAwake: true,
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

  getPeerKeepAwake(): boolean {
    return this.preferences.peerKeepAwake;
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

  setPeerKeepAwake(enabled: boolean): boolean {
    if (enabled === this.preferences.peerKeepAwake) return this.preferences.peerKeepAwake;
    this.preferences = { ...this.preferences, peerKeepAwake: enabled };
    this.persist();
    return this.preferences.peerKeepAwake;
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
    // Migrate the file forward one version at a time so a v1 file chains
    // v1→v2→v3→v4 rather than jumping straight to the latest and skipping the
    // intermediate field-adds (which would fail the strict schema and fall back
    // to defaults, losing the user's mode/commands). Each step advances the
    // version unconditionally; the field is added only when missing so a user
    // who already set it keeps their value. v1→v2 adds activityGate, v2→v3 the
    // battery floor (defaulting to the guard-on default so the floor lights up
    // for existing users), v3→v4 the peer keep-awake trigger (default on).
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    if (record && typeof record.version === "number") {
      if (record.version === 1) {
        if (record.activityGate === undefined) record.activityGate = true;
        record.version = 2;
      }
      if (record.version === 2) {
        if (record.batteryThreshold === undefined) {
          record.batteryThreshold = CAFFEINATE_BATTERY_LOW_WATER_PERCENT_DEFAULT;
        }
        record.version = 3;
      }
      if (record.version === 3) {
        if (record.peerKeepAwake === undefined) record.peerKeepAwake = true;
        record.version = CAFFEINATE_PREFERENCES_FILE_VERSION;
      }
    }
    const parsed = caffeinatePreferencesFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`caffeinate preferences file invalid; using defaults (${this.filePath})`);
      return;
    }
    this.preferences = {
      mode: parsed.data.mode,
      activityGate: parsed.data.activityGate,
      peerKeepAwake: parsed.data.peerKeepAwake,
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
      peerKeepAwake: this.preferences.peerKeepAwake,
      batteryThreshold: this.preferences.batteryThreshold,
      commands: this.preferences.commands,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
