import {
  AUTOMATION_DOWNTIME_RECONCILE_CAP,
  AUTOMATION_RECONCILE_LOOKBACK_MS,
} from "../constants.js";
import { nextCronOccurrence, parseCronExpression } from "../cron-expression.js";
import type { Automation } from "../types.js";
import { compileScheduleAll } from "./compile-schedule.js";
import { memoBy } from "./memo-by.js";

// The most-recent missed scheduled occurrences (epoch-ms) in the downtime
// window (lastAliveAt, now). Enumeration starts no earlier than a fixed
// lookback so a frequent schedule can't walk forever after a long outage; only
// the most-recent AUTOMATION_DOWNTIME_RECONCILE_CAP are kept regardless.
export const enumerateMissedOccurrences = (
  automation: Automation,
  lastAliveAt: number,
  now: number,
): number[] => {
  // Watch triggers have no scheduled occurrences to reconstruct after downtime.
  if (automation.trigger.kind !== "schedule") return [];
  const effectiveFrom = Math.max(lastAliveAt, now - AUTOMATION_RECONCILE_LOOKBACK_MS);
  const fromDate = new Date(effectiveFrom);
  const collected: number[] = [];
  for (const expression of compileScheduleAll(automation.trigger.schedule)) {
    const parsed = parseCronExpression(expression);
    if (!parsed) continue;
    let cursor = nextCronOccurrence(parsed, fromDate);
    while (cursor && cursor.getTime() < now) {
      collected.push(cursor.getTime());
      cursor = nextCronOccurrence(parsed, cursor);
    }
  }
  return memoBy(collected, (epoch) => epoch)
    .sort((a, b) => a - b)
    .slice(-AUTOMATION_DOWNTIME_RECONCILE_CAP);
};
