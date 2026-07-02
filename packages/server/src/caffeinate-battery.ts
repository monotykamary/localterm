import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
  CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT,
  CAFFEINATE_BATTERY_READ_TIMEOUT_MS,
} from "./constants.js";

export interface BatteryStatus {
  // 0–100, integer. The displayed percent (same value `pmset -g batt` shows).
  percent: number;
  // True only when drawing from battery power (not on AC). The floor never
  // applies while plugged in — the whole point is discharge protection.
  isOnBattery: boolean;
  // The OS's EWMA estimate of minutes until 0%, or null when charging / no
  // estimate / on AC. Used only to schedule the next check adaptively; never
  // trusted as a hard prediction.
  minutesToEmpty: number | null;
}

// Reads the machine's battery state. Returns null when there is no battery,
// `pmset` is missing, or the output is unparseable — callers treat null as
// "don't gate" (fail-open) so a desktop Mac or a transient read failure cannot
// wedge the user's keep-awake on bad data.
export type BatteryProbe = () => Promise<BatteryStatus | null>;

const PERCENT_RE = /(\d+)%/;
const TIME_RE = /(\d+):(\d+)\s+remaining/;
const PRESENT_RE = /present:\s*(true|false)/;

export const parsePmsetBatt = (stdout: string): BatteryStatus | null => {
  // `present: false` (e.g. "No Batteries Available" line on a desktop) means
  // there is nothing to gate on. Some desktops print no battery line at all,
  // which also fails the percent match below and resolves to null.
  const presentMatch = PRESENT_RE.exec(stdout);
  if (presentMatch && presentMatch[1] === "false") return null;

  const percentMatch = PERCENT_RE.exec(stdout);
  if (!percentMatch) return null;
  const percent = Number(percentMatch[1]);

  // "Now drawing from 'Battery Power'" is the only line that means discharging.
  // "AC Power" covers both charging and charged-but-plugged-in; in either case
  // the floor does not apply.
  const isOnBattery = /Battery Power/.test(stdout);

  let minutesToEmpty: number | null = null;
  if (isOnBattery) {
    // Only trust the time estimate on battery: the AC "remaining" is time to
    // full charge, not to empty, and would blow up the adaptive scheduler.
    const timeMatch = TIME_RE.exec(stdout);
    if (timeMatch) minutesToEmpty = Number(timeMatch[1]) * 60 + Number(timeMatch[2]);
  }
  return { percent, isOnBattery, minutesToEmpty };
};

export const clampBatteryPercent = (percent: number): number => {
  if (!Number.isFinite(percent)) {
    return CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT;
  }
  const floored = Math.floor(percent);
  return Math.min(
    CAFFEINATE_BATTERY_LOW_WATER_MAX_PERCENT,
    Math.max(CAFFEINATE_BATTERY_LOW_WATER_MIN_PERCENT, floored),
  );
};

// Linux reads battery state straight from sysfs (`/sys/class/power_supply`),
// which every laptop exposes regardless of desktop environment — no `upower`
// daemon or `acpi` dependency. Each `BAT*` (or board-specific battery) dir has
// `capacity` (0–100), `status` (Discharging/Charging/Full/Not charging), and
// `time_to_empty_now` (seconds, present only while discharging). A device with
// `type` of "Battery" is the one we gate on; non-battery supplies are skipped.
// `files` is parameterized so tests can drive the parser without touching disk.
export const parseSysfsBattery = (files: {
  capacity: string;
  status: string;
  timeToEmptyNow?: string;
}): BatteryStatus | null => {
  // sysfs `capacity` is an integer 0-100. Validate with a strict `\d+` match
  // rather than `Number()` + isFinite: `Number("")` and `Number("  ")` coerce
  // to 0 (finite), so a malformed/absent read would otherwise surface as 0%
  // instead of failing open to null.
  const trimmedCapacity = files.capacity.trim();
  if (!/^\d+$/.test(trimmedCapacity)) return null;
  const percent = Number(trimmedCapacity);
  // sysfs `status` is one of: Charging, Discharging, Not charging, Full, Unknown.
  // Only Discharging means drawing from battery; everything else (incl. Full
  // while plugged in) leaves the floor off.
  const isOnBattery = /^Discharging$/.test(files.status.trim());
  let minutesToEmpty: number | null = null;
  if (isOnBattery && files.timeToEmptyNow !== undefined) {
    const seconds = Number(files.timeToEmptyNow);
    if (Number.isFinite(seconds) && seconds > 0) minutesToEmpty = Math.floor(seconds / 60);
  }
  return { percent, isOnBattery, minutesToEmpty };
};

const SYSFS_POWER_SUPPLY_DIR = "/sys/class/power_supply";

const probeSysfsBattery: BatteryProbe = async () => {
  let names: string[];
  try {
    names = await readdir(SYSFS_POWER_SUPPLY_DIR);
  } catch {
    return null;
  }
  for (const name of names) {
    const dir = join(SYSFS_POWER_SUPPLY_DIR, name);
    const read = (file: string): Promise<string | undefined> =>
      readFile(join(dir, file), "utf8")
        .then((text) => text.trim())
        .catch(() => undefined);
    const type = (await read("type")) ?? "";
    if (type.trim() !== "Battery") continue;
    const [capacity, status, timeToEmptyNow] = await Promise.all([
      read("capacity"),
      read("status"),
      read("time_to_empty_now"),
    ]);
    if (capacity === undefined || status === undefined) continue;
    const parsed = parseSysfsBattery({
      capacity,
      status,
      timeToEmptyNow: timeToEmptyNow ?? undefined,
    });
    if (parsed) return parsed;
  }
  return null;
};

const probePmset: BatteryProbe = () =>
  new Promise((resolve) => {
    execFile(
      "pmset",
      ["-g", "batt"],
      { timeout: CAFFEINATE_BATTERY_READ_TIMEOUT_MS },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parsePmsetBatt(stdout));
      },
    );
  });

// macOS reads `pmset -g batt`; Linux reads sysfs (no external binary). Both
// resolve to null on any failure so callers fail-open (a desktop or a transient
// read error never keeps the user's keep-awake off on bad data).
export const defaultBatteryProbe: BatteryProbe = () =>
  process.platform === "linux" ? probeSysfsBattery() : probePmset();
