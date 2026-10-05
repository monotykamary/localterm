import type { Automation } from "../types.js";
import { nextScheduleOccurrence } from "./next-schedule-occurrence.js";

export const computeNextAutomationRunAt = (automation: Automation, from: Date): number | null => {
  if (!automation.enabled || automation.lifecycle === "finished") return null;
  if (automation.trigger.kind !== "schedule") return null;
  return nextScheduleOccurrence(automation.trigger.schedule, from, automation.timezone);
};
