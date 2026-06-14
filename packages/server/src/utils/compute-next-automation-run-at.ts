import { nextCronOccurrence, parseCronExpression } from "../cron-expression.js";
import type { Automation } from "../types.js";
import { compileScheduleAll } from "./compile-schedule.js";

export const computeNextAutomationRunAt = (automation: Automation, from: Date): number | null => {
  if (!automation.enabled) return null;
  if (automation.lifecycle === "finished") return null;
  // Watch triggers have no time-based next run.
  if (automation.trigger.kind !== "schedule") return null;
  // The earliest next occurrence across every compiled cron (timesOfDay yields
  // several); skip any expression that fails to parse.
  const candidates: number[] = [];
  for (const expression of compileScheduleAll(automation.trigger.schedule)) {
    const parsed = parseCronExpression(expression);
    if (!parsed) continue;
    const next = nextCronOccurrence(parsed, from);
    if (next) candidates.push(next.getTime());
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
};
