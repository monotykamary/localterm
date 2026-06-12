import { nextCronOccurrence, parseCronExpression } from "../cron-expression.js";
import type { Automation } from "../types.js";

export const computeNextAutomationRunAt = (automation: Automation, from: Date): number | null => {
  if (!automation.enabled) return null;
  const parsed = parseCronExpression(automation.schedule);
  if (!parsed) return null;
  return nextCronOccurrence(parsed, from)?.getTime() ?? null;
};
