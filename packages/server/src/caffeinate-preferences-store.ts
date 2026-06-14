import fs from "node:fs";
import path from "node:path";
import {
  CAFFEINATE_PREFERENCES_FILE_VERSION,
  MAX_CAFFEINATE_COMMAND_LENGTH,
  MAX_CAFFEINATE_COMMANDS,
} from "./constants.js";
import { caffeinatePreferencesFileSchema } from "./schemas.js";
import type { CaffeinateMode } from "./types.js";

interface CaffeinatePreferences {
  mode: CaffeinateMode;
  commands: string[];
}

// Default to "automatic": keep-awake follows recognized programs out of the box
// (the behavior the user asked to make default), with no custom commands yet.
const DEFAULT_PREFERENCES: CaffeinatePreferences = {
  mode: "automatic",
  commands: [],
};

// Trim, drop empties, cap length, dedupe case-insensitively (keeping the first
// spelling), and cap the count. The trigger match itself is case-insensitive,
// so "Claude" and "claude" are the same trigger.
const sanitizeCommands = (commands: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of commands) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const capped = trimmed.slice(0, MAX_CAFFEINATE_COMMAND_LENGTH);
    const key = capped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(capped);
    if (result.length >= MAX_CAFFEINATE_COMMANDS) break;
  }
  return result;
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
    const parsed = caffeinatePreferencesFileSchema.safeParse(json);
    if (!parsed.success) {
      console.warn(`caffeinate preferences file invalid; using defaults (${this.filePath})`);
      return;
    }
    this.preferences = {
      mode: parsed.data.mode,
      commands: sanitizeCommands(parsed.data.commands),
    };
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = {
      version: CAFFEINATE_PREFERENCES_FILE_VERSION,
      mode: this.preferences.mode,
      commands: this.preferences.commands,
    };
    const tmpPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    fs.renameSync(tmpPath, this.filePath);
  }
}
