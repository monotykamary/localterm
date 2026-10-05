import {
  AUTOMATION_DOWNTIME_RECONCILE_CAP,
  AUTOMATION_RECONCILE_LOOKBACK_MS,
} from "../constants.js";
import type { Automation } from "../types.js";
import { recentScheduleOccurrences } from "./next-schedule-occurrence.js";

// Both boundaries are exclusive. Search newest-first so neither memory nor
// work grows with every missed minute of a long outage.
export const enumerateMissedOccurrences = (
  automation: Automation,
  lastAliveAt: number,
  now: number,
): number[] => {
  if (automation.trigger.kind !== "schedule") return [];
  return recentScheduleOccurrences(
    automation.trigger.schedule,
    Math.max(lastAliveAt, now - AUTOMATION_RECONCILE_LOOKBACK_MS),
    now,
    AUTOMATION_DOWNTIME_RECONCILE_CAP,
    automation.timezone,
  );
};
