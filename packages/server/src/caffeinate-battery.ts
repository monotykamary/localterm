import { execFile } from "node:child_process";
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

export const defaultBatteryProbe: BatteryProbe = () =>
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
